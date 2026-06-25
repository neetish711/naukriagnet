"""Stage 3 — Resume & Cover Letter tailoring via LLM.

Ports the AIHawk resume tailoring approach:
- Extracts ATS keywords from the job description
- Reframes existing experience (never fabricates)
- Produces a tailored cover letter
- Outputs as PDF resume + plain text cover letter
"""
from __future__ import annotations
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Tuple
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.models import ScoredJob, ApplicationRecord, AppStatus
from core.state import init_db, get_apply_jobs, upsert_application
from core import logger


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_config() -> Tuple[dict, dict]:
    base = Path(__file__).parent.parent / "config"
    with open(base / "profile.yaml") as f:
        profile = yaml.safe_load(f)
    with open(base / "secrets.yaml") as f:
        secrets = yaml.safe_load(f)
    return profile, secrets


def _slug(text: str) -> str:
    return re.sub(r"[^\w]+", "_", text.strip().lower())[:40]


def _call_llm(prompt: str, secrets: dict) -> str:
    openai_key = secrets.get("openai_api_key") or os.environ.get("OPENAI_API_KEY", "")
    if openai_key:
        try:
            from openai import OpenAI  # type: ignore
            client = OpenAI(api_key=openai_key)
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            logger.warning(f"  OpenAI failed ({e}), using Ollama")

    model = secrets.get("ollama_model", "llama3.1:8b")
    try:
        import ollama  # type: ignore
        resp = ollama.chat(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0.3},
        )
        return resp["message"]["content"]
    except Exception as e:
        raise RuntimeError(f"All LLM backends failed: {e}")


# ── ATS keyword extraction ────────────────────────────────────────────────────

_KW_PROMPT = """Extract the top 15 ATS (Applicant Tracking System) keywords from this job description.
Return ONLY a comma-separated list of keywords/phrases, no explanations.

Job Description:
{description}"""


def _extract_keywords(description: str, secrets: dict) -> List[str]:
    try:
        raw = _call_llm(_KW_PROMPT.format(description=description[:1200]), secrets)
        return [kw.strip() for kw in raw.split(",") if kw.strip()][:15]
    except Exception:
        return []


# ── Resume tailoring ──────────────────────────────────────────────────────────

_RESUME_PROMPT = """You are an expert resume writer. Your task is to tailor this resume for a specific job.

IMPORTANT RULES:
1. NEVER invent or fabricate experience, skills, or achievements
2. Only reorganize, reframe, and emphasize what already exists
3. Inject relevant ATS keywords naturally into existing bullet points
4. Put the most relevant experience first
5. Keep it truthful and professional

Candidate's base resume text:
{resume_text}

Target Job:
Title: {title}
Company: {company}
ATS Keywords to weave in: {keywords}
Job Description (first 600 chars): {description}

Output a tailored resume in plain text. Use standard resume sections:
SUMMARY, EXPERIENCE, SKILLS, EDUCATION
Keep total length under 600 words."""


_COVER_PROMPT = """Write a concise, personalised cover letter for this job application.

Rules:
- 3 short paragraphs max
- Paragraph 1: Who you are and why you're excited about {company} specifically
- Paragraph 2: One concrete achievement that directly maps to their needs
- Paragraph 3: Simple call to action
- Tone: Confident but not arrogant, conversational
- Never use filler phrases like "I am writing to express my interest"

Candidate: {name} ({experience_summary})
Role: {title} at {company}
Key requirements from JD: {keywords}
Company/role context: {description_snippet}

Output ONLY the letter body (no subject, no date header)."""


def _tailor_resume(job: ScoredJob, profile: dict, secrets: dict,
                   resume_text: str, keywords: List[str]) -> str:
    prompt = _RESUME_PROMPT.format(
        resume_text=resume_text[:2000],
        title=job.job.title,
        company=job.job.company,
        keywords=", ".join(keywords),
        description=job.job.description[:600],
    )
    try:
        return _call_llm(prompt, secrets)
    except Exception as e:
        logger.error(f"  Resume tailoring failed: {e}")
        return resume_text  # Fall back to base resume


def _write_cover_letter(job: ScoredJob, profile: dict, secrets: dict,
                        keywords: List[str]) -> str:
    personal = profile.get("personal", {})
    prompt = _COVER_PROMPT.format(
        name=personal.get("name", "Applicant"),
        experience_summary=profile.get("experience_summary", "Experienced engineer"),
        title=job.job.title,
        company=job.job.company,
        keywords=", ".join(keywords[:8]),
        description_snippet=job.job.description[:400],
    )
    try:
        return _call_llm(prompt, secrets)
    except Exception as e:
        logger.error(f"  Cover letter generation failed: {e}")
        return f"Please accept this application for the {job.job.title} role at {job.job.company}."


# ── PDF generation ────────────────────────────────────────────────────────────

def _save_as_pdf(text: str, output_path: Path) -> bool:
    try:
        from reportlab.lib.pagesizes import letter  # type: ignore
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer  # type: ignore
        from reportlab.lib.styles import getSampleStyleSheet  # type: ignore

        doc = SimpleDocTemplate(str(output_path), pagesize=letter,
                                leftMargin=72, rightMargin=72,
                                topMargin=72, bottomMargin=72)
        styles = getSampleStyleSheet()
        story = []
        for line in text.split("\n"):
            line = line.strip()
            if not line:
                story.append(Spacer(1, 8))
            elif line.isupper() and len(line) < 40:
                story.append(Paragraph(f"<b>{line}</b>", styles["Heading2"]))
            else:
                story.append(Paragraph(line, styles["Normal"]))
        doc.build(story)
        return True
    except ImportError:
        logger.warning("  reportlab not installed — saving resume as .txt instead")
        output_path.with_suffix(".txt").write_text(text)
        return False
    except Exception as e:
        logger.error(f"  PDF generation failed: {e}")
        output_path.with_suffix(".txt").write_text(text)
        return False


def _read_base_resume(profile: dict) -> str:
    resume_path = Path(__file__).parent.parent / profile.get("resume_path", "assets/resume.pdf")
    if not resume_path.exists():
        logger.warning(f"  Base resume not found at {resume_path} — using profile summary")
        personal = profile.get("personal", {})
        skills = profile.get("skills", [])
        return (
            f"Name: {personal.get('name', '')}\n"
            f"Email: {personal.get('email', '')}\n"
            f"LinkedIn: {personal.get('linkedin', '')}\n\n"
            f"SUMMARY\n{profile.get('experience_summary', '')}\n\n"
            f"SKILLS\n{', '.join(skills)}"
        )
    # Try to extract text from PDF
    try:
        import PyPDF2  # type: ignore
        reader = PyPDF2.PdfReader(str(resume_path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except ImportError:
        pass
    try:
        import pdfplumber  # type: ignore
        with pdfplumber.open(str(resume_path)) as pdf:
            return "\n".join(p.extract_text() or "" for p in pdf.pages)
    except ImportError:
        pass
    logger.warning("  No PDF parser available (install PyPDF2 or pdfplumber). Using profile summary.")
    return profile.get("experience_summary", "Experienced software engineer")


# ── Main Stage ────────────────────────────────────────────────────────────────

def run(dry_run: bool = False) -> int:
    """Run Stage 3. Returns count of tailored applications."""
    logger.stage("Stage 3 — Resume & Cover Letter Tailoring")
    init_db()

    profile, secrets = _load_config()
    output_dir = Path(__file__).parent.parent / "outputs"
    output_dir.mkdir(exist_ok=True)

    apply_jobs = get_apply_jobs()
    if not apply_jobs:
        logger.info("No APPLY-decision jobs found (run Stages 1 & 2 first)")
        return 0

    resume_text = _read_base_resume(profile)
    logger.info(f"Tailoring materials for {len(apply_jobs)} jobs...")

    done = 0
    with logger.make_progress() as progress:
        task = progress.add_task("Tailoring...", total=len(apply_jobs))

        for scored in apply_jobs:
            job = scored.job
            company_slug = _slug(job.company)
            role_slug = _slug(job.title)
            resume_out = output_dir / f"{company_slug}_{role_slug}_resume.pdf"
            cover_out = output_dir / f"{company_slug}_{role_slug}_cover.txt"

            if dry_run:
                keywords = ["Python", "LLM", "RAG", "FastAPI"]
                tailored_resume = f"[DRY-RUN] Tailored resume for {job.title} at {job.company}"
                cover_letter = f"[DRY-RUN] Cover letter for {job.title} at {job.company}"
            else:
                keywords = _extract_keywords(job.description, secrets)
                tailored_resume = _tailor_resume(scored, profile, secrets, resume_text, keywords)
                cover_letter = _write_cover_letter(scored, profile, secrets, keywords)

            # Save files
            if not dry_run:
                _save_as_pdf(tailored_resume, resume_out)
            else:
                resume_out.with_suffix(".txt").write_text(tailored_resume)
                resume_out = resume_out.with_suffix(".txt")

            cover_out.write_text(cover_letter)

            # Persist application record
            rec = ApplicationRecord(
                job_id=job.id,
                company=job.company,
                role=job.title,
                url=job.url,
                source=job.source,
                score=scored.score,
                decision=scored.decision.value,
                status=AppStatus.PENDING,
                resume_path=str(resume_out),
                cover_letter_path=str(cover_out),
            )
            upsert_application(rec)

            logger.success(f"  Tailored: {job.title} @ {job.company}")
            done += 1
            progress.advance(task)

    logger.success(f"Stage 3 complete — {done} applications tailored")
    return done


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
