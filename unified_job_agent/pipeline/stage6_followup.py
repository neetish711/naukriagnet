"""Stage 6 — Follow-Up & Status Tracking.

Schedule:
- Day 3 after email_sent_at: send one polite follow-up
- Day 7 with no reply: mark GHOSTED, no further emails

CLI: python run.py status  →  rich table of all applications
"""
from __future__ import annotations
import os
import sys
import smtplib
import time
import random
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import List
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


# ── Follow-up email generation ────────────────────────────────────────────────

def _generate_followup(rec: ApplicationRecord, profile: dict) -> str:
    personal = profile.get("personal", {})
    name = personal.get("name", "Applicant")
    return (
        f"I wanted to follow up on my application for the {rec.role} role at {rec.company}. "
        f"I remain genuinely excited about the opportunity and would love to discuss how my "
        f"background fits your needs. Please let me know if you need any additional information."
    )


def _send_followup(rec: ApplicationRecord, body: str,
                   profile: dict, secrets: dict, dry_run: bool) -> bool:
    personal = profile.get("personal", {})
    sender = secrets.get("smtp_user", "")
    name = personal.get("name", sender)
    to = rec.recruiter_email

    if not to:
        return False

    subject = f"Following up: {rec.role} at {rec.company} — {name}"

    if dry_run:
        logger.info(f"  [dry-run] Would send follow-up to {to}: {subject}")
        return True

    if not sender:
        logger.error("  smtp_user not configured")
        return False

    msg = MIMEMultipart()
    msg["From"] = f"{name} <{sender}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

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
        logger.error(f"  Follow-up SMTP error to {to}: {e}")
        return False


# ── Status table ──────────────────────────────────────────────────────────────

def print_status_table():
    """Print rich table of all applications."""
    from rich.table import Table
    from rich.console import Console
    from core.state import get_applications

    console = Console()
    apps = get_applications()

    if not apps:
        console.print("[yellow]No applications tracked yet.[/yellow]")
        return

    table = Table(
        title="Application Tracker",
        show_header=True,
        header_style="bold magenta",
    )
    table.add_column("Company", style="cyan", no_wrap=True)
    table.add_column("Role", style="white")
    table.add_column("Applied", style="green")
    table.add_column("Email Sent", style="blue")
    table.add_column("Status", style="bold")
    table.add_column("Days Since Apply", justify="right")

    now = datetime.now()
    status_colors = {
        "APPLIED": "green",
        "EMAIL_SENT": "blue",
        "FOLLOWED_UP": "cyan",
        "GHOSTED": "dim red",
        "FAILED": "red",
        "MANUAL_REVIEW": "yellow",
        "PENDING": "white",
    }

    for rec in sorted(apps, key=lambda r: r.applied_at or datetime.min, reverse=True):
        applied_str = rec.applied_at.strftime("%Y-%m-%d") if rec.applied_at else "-"
        email_str = rec.email_sent_at.strftime("%Y-%m-%d") if rec.email_sent_at else "-"
        days = (now - rec.applied_at).days if rec.applied_at else "-"
        color = status_colors.get(rec.status.value, "white")

        table.add_row(
            rec.company[:25],
            rec.role[:35],
            applied_str,
            email_str,
            f"[{color}]{rec.status.value}[/{color}]",
            str(days),
        )

    console.print(table)
    console.print(f"\nTotal: {len(apps)} applications")


# ── Main Stage ────────────────────────────────────────────────────────────────

def run(dry_run: bool = False) -> int:
    """Run Stage 6. Returns count of follow-ups sent."""
    logger.stage("Stage 6 — Follow-Up & Status Tracker")
    init_db()

    profile, secrets = _load_config()
    now = datetime.now()
    followup_day = 3
    ghost_day = 7

    # Get all emailed applications
    emailed = get_applications(AppStatus.EMAIL_SENT)
    followed = get_applications(AppStatus.FOLLOWED_UP)

    followup_candidates = emailed
    ghost_candidates = emailed + followed

    followups_sent = 0
    ghosted_count = 0

    with logger.make_progress() as progress:
        task = progress.add_task("Processing follow-ups...",
                                 total=len(ghost_candidates))

        for rec in ghost_candidates:
            ref_time = rec.followup_sent_at or rec.email_sent_at
            if not ref_time:
                progress.advance(task)
                continue

            days_since = (now - ref_time).days

            # Ghost after 7 days of last email with no reply
            if days_since >= ghost_day:
                rec.status = AppStatus.GHOSTED
                rec.notes = f"No reply after {days_since} days"
                upsert_application(rec)
                logger.info(f"  GHOSTED: {rec.role} @ {rec.company} ({days_since}d)")
                ghosted_count += 1
                progress.advance(task)
                continue

            # Follow up after 3 days (only for EMAIL_SENT, not already followed up)
            if rec.status == AppStatus.EMAIL_SENT and days_since >= followup_day:
                body = _generate_followup(rec, profile)
                ok = _send_followup(rec, body, profile, secrets, dry_run)
                if ok:
                    rec.status = AppStatus.FOLLOWED_UP
                    rec.followup_sent_at = now
                    upsert_application(rec)
                    log_email(rec.job_id, rec.recruiter_email or "",
                              f"Follow-up: {rec.role} @ {rec.company}", kind="followup")
                    logger.success(f"  Follow-up sent: {rec.role} @ {rec.company}")
                    followups_sent += 1

                if not dry_run:
                    time.sleep(random.uniform(2, 5))

            progress.advance(task)

    logger.success(
        f"Stage 6 complete — {followups_sent} follow-ups sent, {ghosted_count} marked GHOSTED"
    )
    return followups_sent


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
