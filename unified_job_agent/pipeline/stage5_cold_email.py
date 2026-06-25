"""Stage 5 — Cold Email Outreach to recruiters / hiring managers.

Flow:
1. Find recruiter email via Hunter.io → fallback to pattern generation → SMTP probe
2. Generate personalised cold email via LLM
3. Attach tailored resume
4. Send via SMTP (Gmail / SendGrid)
5. Log to SQLite
"""
from __future__ import annotations
import os
import sys
import smtplib
import socket
import time
import random
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from pathlib import Path
from typing import List, Optional
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.models import ApplicationRecord, AppStatus
from core.state import init_db, get_applications, upsert_application, log_email
from core import logger


# ── Config ────────────────────────────────────────────────────────────────────

def _load_config():
    base = Path(__file__).parent.parent / "config"
    with open(base / "profile.yaml") as f:
        profile = yaml.safe_load(f)
    with open(base / "secrets.yaml") as f:
        secrets = yaml.safe_load(f)
    return profile, secrets


# ── Email discovery ───────────────────────────────────────────────────────────

def _domain_from_company(company: str) -> str:
    """Best-effort company domain guess."""
    slug = company.lower().strip()
    slug = "".join(c for c in slug if c.isalnum() or c == " ").split()
    return f"{''.join(slug[:2])}.com"


def _hunter_find_email(company: str, hunter_key: str) -> Optional[str]:
    """Use Hunter.io domain search to find most likely recruiter email."""
    if not hunter_key:
        return None
    try:
        import requests
        domain = _domain_from_company(company)
        resp = requests.get(
            "https://api.hunter.io/v2/domain-search",
            params={"domain": domain, "api_key": hunter_key, "type": "personal",
                    "seniority": "senior,executive", "department": "hr,management"},
            timeout=10,
        )
        data = resp.json().get("data", {})
        emails = data.get("emails", [])
        if emails:
            return emails[0].get("value")
    except Exception as e:
        logger.warning(f"  Hunter.io error for {company}: {e}")
    return None


def _generate_email_patterns(first: str, last: str, domain: str) -> List[str]:
    """ColdContactXLSX-style email pattern generation."""
    f, l = first.lower(), last.lower()
    return [
        f"{f}@{domain}",
        f"{f}.{l}@{domain}",
        f"{f[0]}{l}@{domain}",
        f"{f[0]}.{l}@{domain}",
        f"{l}@{domain}",
        f"{l}.{f}@{domain}",
        f"hi@{domain}",
        f"jobs@{domain}",
        f"recruiting@{domain}",
        f"hr@{domain}",
    ]


def _smtp_verify(email: str, sender_domain: str = "gmail.com") -> bool:
    """Probe SMTP RCPT TO to verify deliverability (best-effort)."""
    try:
        domain = email.split("@")[1]
        import dns.resolver  # type: ignore
        mx_records = dns.resolver.resolve(domain, "MX")
        mx_host = str(sorted(mx_records, key=lambda r: r.preference)[0].exchange)

        with smtplib.SMTP(mx_host, 25, timeout=5) as smtp:
            smtp.ehlo(sender_domain)
            smtp.mail(f"probe@{sender_domain}")
            code, _ = smtp.rcpt(email)
            return code == 250
    except Exception:
        return True  # Assume valid if we can't check (avoid false negatives)


def find_recruiter_email(company: str, secrets: dict) -> Optional[str]:
    """Multi-strategy email finder."""
    hunter_key = secrets.get("hunter_api_key", "")

    # Strategy 1: Hunter.io
    email = _hunter_find_email(company, hunter_key)
    if email:
        logger.info(f"  Email found via Hunter.io: {email}")
        return email

    # Strategy 2: Pattern generation with generic recruiter names
    domain = _domain_from_company(company)
    candidates = [
        f"recruiting@{domain}",
        f"talent@{domain}",
        f"hr@{domain}",
        f"careers@{domain}",
        f"jobs@{domain}",
        f"hello@{domain}",
    ]
    for cand in candidates:
        if _smtp_verify(cand):
            logger.info(f"  Email candidate verified: {cand}")
            return cand

    logger.warning(f"  Could not find verified email for {company}")
    return None


# ── Email generation ──────────────────────────────────────────────────────────

_EMAIL_PROMPT = """Write a cold email from a job applicant to a hiring manager/recruiter.

Rules:
- Subject line: "Re: {role} application — {name}"
- Body: 3 sentences MAXIMUM
  1. Who you are + one specific thing you admire about {company}
  2. One concrete, quantified achievement relevant to the role
  3. Single ask: "Would you have 15 minutes to connect?" or "Could you confirm receipt?"
- No filler phrases. Direct. Professional. Human.

Sender: {name}
Role applied for: {role} at {company}
Sender's top relevant achievement: {achievement}
Company context: {description_snippet}

Output ONLY the email body (no subject line, no salutation, no sign-off)."""


def _generate_cold_email(rec: ApplicationRecord, profile: dict, secrets: dict) -> str:
    personal = profile.get("personal", {})
    name = personal.get("name", "Applicant")
    experience = profile.get("experience_summary", "")
    # Extract first sentence as "achievement"
    achievement = experience.split(".")[0] if experience else "Built production ML systems"

    prompt = _EMAIL_PROMPT.format(
        name=name,
        role=rec.role,
        company=rec.company,
        achievement=achievement,
        description_snippet=rec.url,  # We don't store full description on record
    )

    openai_key = secrets.get("openai_api_key") or os.environ.get("OPENAI_API_KEY", "")
    if openai_key:
        try:
            from openai import OpenAI  # type: ignore
            client = OpenAI(api_key=openai_key)
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.4,
            )
            return resp.choices[0].message.content or ""
        except Exception:
            pass

    model = secrets.get("ollama_model", "llama3.1:8b")
    try:
        import ollama  # type: ignore
        resp = ollama.chat(model=model,
                           messages=[{"role": "user", "content": prompt}],
                           options={"temperature": 0.4})
        return resp["message"]["content"]
    except Exception as e:
        logger.error(f"  LLM email generation failed: {e}")
        personal_name = profile.get("personal", {}).get("name", "Applicant")
        return (
            f"I recently applied for the {rec.role} role at {rec.company} and wanted to follow up directly. "
            f"I'm excited about {rec.company}'s work and believe my background is a strong fit. "
            f"Would you have 15 minutes to connect this week?"
        )


# ── SMTP send ─────────────────────────────────────────────────────────────────

def _send_email(to: str, subject: str, body: str, resume_path: Optional[str],
                profile: dict, secrets: dict, dry_run: bool) -> bool:
    personal = profile.get("personal", {})
    sender = secrets.get("smtp_user", "")
    sender_name = personal.get("name", sender)

    if dry_run:
        logger.info(f"  [dry-run] Would send email to {to}: {subject}")
        return True

    if not sender:
        logger.error("  smtp_user not configured in secrets.yaml")
        return False

    msg = MIMEMultipart()
    msg["From"] = f"{sender_name} <{sender}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    # Attach resume
    if resume_path and Path(resume_path).exists():
        with open(resume_path, "rb") as f:
            part = MIMEBase("application", "octet-stream")
            part.set_payload(f.read())
        encoders.encode_base64(part)
        part.add_header(
            "Content-Disposition",
            f"attachment; filename={Path(resume_path).name}",
        )
        msg.attach(part)

    try:
        with smtplib.SMTP(
            secrets.get("smtp_host", "smtp.gmail.com"),
            int(secrets.get("smtp_port", 587)),
            timeout=30,
        ) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(sender, secrets.get("smtp_password", ""))
            smtp.sendmail(sender, to, msg.as_string())
        return True
    except Exception as e:
        logger.error(f"  SMTP send failed to {to}: {e}")
        return False


# ── Main Stage ────────────────────────────────────────────────────────────────

def run(dry_run: bool = False) -> int:
    """Run Stage 5. Returns count of emails sent."""
    logger.stage("Stage 5 — Cold Email Outreach")
    init_db()

    profile, secrets = _load_config()
    personal = profile.get("personal", {})

    # Only email for applied jobs that haven't been emailed yet
    applied = [
        r for r in get_applications(AppStatus.APPLIED)
        if r.email_sent_at is None
    ]

    if not applied:
        logger.info("No newly-applied jobs to email (run Stage 4 first or all already emailed)")
        return 0

    logger.info(f"Sending cold emails for {len(applied)} applications...")

    sent = 0
    with logger.make_progress() as progress:
        task = progress.add_task("Sending emails...", total=len(applied))

        for rec in applied:
            # Find recruiter email
            email = find_recruiter_email(rec.company, secrets)
            if not email:
                logger.warning(f"  Skipping {rec.company} — no email found")
                progress.advance(task)
                continue

            # Generate email
            body = _generate_cold_email(rec, profile, secrets)
            subject = f"Re: {rec.role} application — {personal.get('name', 'Applicant')}"

            # Send
            ok = _send_email(email, subject, body, rec.resume_path, profile, secrets, dry_run)

            if ok:
                rec.recruiter_email = email
                rec.email_sent_at = datetime.now()
                rec.status = AppStatus.EMAIL_SENT
                upsert_application(rec)
                log_email(rec.job_id, email, subject, kind="cold")
                logger.success(f"  Email sent → {email} ({rec.role} @ {rec.company})")
                sent += 1
            else:
                logger.warning(f"  Email failed for {rec.company}")

            if not dry_run:
                time.sleep(random.uniform(2, 5))  # Rate limiting

            progress.advance(task)

    logger.success(f"Stage 5 complete — {sent} cold emails sent")
    return sent


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
