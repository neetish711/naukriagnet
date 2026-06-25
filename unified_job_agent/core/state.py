"""SQLite-backed state machine for tracking job application pipeline state."""
from __future__ import annotations
import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from contextlib import contextmanager

from .models import Job, ScoredJob, ApplicationRecord, AppStatus, Decision

DB_PATH = Path(__file__).parent.parent / "data" / "state.db"


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


@contextmanager
def _tx():
    conn = _conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with _tx() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                title TEXT,
                company TEXT,
                url TEXT UNIQUE,
                description TEXT,
                source TEXT,
                location TEXT,
                date_posted TEXT,
                discovered_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS scored_jobs (
                job_id TEXT PRIMARY KEY,
                score REAL,
                decision TEXT,
                reason TEXT,
                scored_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY(job_id) REFERENCES jobs(id)
            );

            CREATE TABLE IF NOT EXISTS applications (
                job_id TEXT PRIMARY KEY,
                company TEXT,
                role TEXT,
                url TEXT,
                source TEXT,
                score REAL,
                decision TEXT,
                status TEXT DEFAULT 'PENDING',
                applied_at TEXT,
                email_sent_at TEXT,
                followup_sent_at TEXT,
                recruiter_email TEXT,
                resume_path TEXT,
                cover_letter_path TEXT,
                notes TEXT DEFAULT '',
                FOREIGN KEY(job_id) REFERENCES jobs(id)
            );

            CREATE TABLE IF NOT EXISTS emails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT,
                recipient TEXT,
                subject TEXT,
                sent_at TEXT DEFAULT (datetime('now')),
                kind TEXT DEFAULT 'cold'
            );
        """)


# ── Jobs ──────────────────────────────────────────────────────────────────────

def save_job(job: Job) -> bool:
    """Returns True if new, False if duplicate."""
    with _tx() as conn:
        try:
            conn.execute(
                "INSERT INTO jobs(id,title,company,url,description,source,location,date_posted) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (job.id, job.title, job.company, job.url, job.description,
                 job.source, job.location, job.date_posted)
            )
            return True
        except sqlite3.IntegrityError:
            return False


def get_undecided_jobs() -> List[Job]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM jobs WHERE id NOT IN (SELECT job_id FROM scored_jobs)"
        ).fetchall()
    return [_row_to_job(r) for r in rows]


def get_apply_jobs() -> List[ScoredJob]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT j.*, s.score, s.decision, s.reason FROM jobs j "
            "JOIN scored_jobs s ON j.id = s.job_id "
            "WHERE s.decision = 'APPLY' "
            "AND j.id NOT IN (SELECT job_id FROM applications WHERE status != 'FAILED')"
        ).fetchall()
    results = []
    for r in rows:
        job = _row_to_job(r)
        results.append(ScoredJob(job=job, score=r["score"],
                                 decision=Decision(r["decision"]), reason=r["reason"]))
    return results


def save_score(scored: ScoredJob):
    with _tx() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO scored_jobs(job_id,score,decision,reason) VALUES(?,?,?,?)",
            (scored.job.id, scored.score, scored.decision.value, scored.reason)
        )


# ── Applications ──────────────────────────────────────────────────────────────

def upsert_application(rec: ApplicationRecord):
    with _tx() as conn:
        conn.execute("""
            INSERT INTO applications
                (job_id,company,role,url,source,score,decision,status,
                 applied_at,email_sent_at,followup_sent_at,recruiter_email,
                 resume_path,cover_letter_path,notes)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(job_id) DO UPDATE SET
                status=excluded.status,
                applied_at=COALESCE(excluded.applied_at, applied_at),
                email_sent_at=COALESCE(excluded.email_sent_at, email_sent_at),
                followup_sent_at=COALESCE(excluded.followup_sent_at, followup_sent_at),
                recruiter_email=COALESCE(excluded.recruiter_email, recruiter_email),
                resume_path=COALESCE(excluded.resume_path, resume_path),
                cover_letter_path=COALESCE(excluded.cover_letter_path, cover_letter_path),
                notes=excluded.notes
        """, (
            rec.job_id, rec.company, rec.role, rec.url, rec.source,
            rec.score, rec.decision, rec.status.value,
            rec.applied_at.isoformat() if rec.applied_at else None,
            rec.email_sent_at.isoformat() if rec.email_sent_at else None,
            rec.followup_sent_at.isoformat() if rec.followup_sent_at else None,
            rec.recruiter_email, rec.resume_path, rec.cover_letter_path, rec.notes
        ))


def get_applications(status: Optional[AppStatus] = None) -> List[ApplicationRecord]:
    with _conn() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM applications WHERE status=?", (status.value,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM applications").fetchall()
    return [_row_to_app(r) for r in rows]


def reset_failed():
    with _tx() as conn:
        conn.execute(
            "UPDATE applications SET status='PENDING',notes='' WHERE status='FAILED'"
        )


def log_email(job_id: str, recipient: str, subject: str, kind: str = "cold"):
    with _tx() as conn:
        conn.execute(
            "INSERT INTO emails(job_id,recipient,subject,kind) VALUES(?,?,?,?)",
            (job_id, recipient, subject, kind)
        )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_job(r) -> Job:
    j = Job.__new__(Job)
    j.id = r["id"]
    j.title = r["title"]
    j.company = r["company"]
    j.url = r["url"]
    j.description = r["description"] or ""
    j.source = r["source"]
    j.location = r["location"] or ""
    j.date_posted = r["date_posted"] or ""
    return j


def _row_to_app(r) -> ApplicationRecord:
    def _dt(s):
        return datetime.fromisoformat(s) if s else None

    return ApplicationRecord(
        job_id=r["job_id"],
        company=r["company"],
        role=r["role"],
        url=r["url"],
        source=r["source"],
        score=r["score"],
        decision=r["decision"],
        status=AppStatus(r["status"]),
        applied_at=_dt(r["applied_at"]),
        email_sent_at=_dt(r["email_sent_at"]),
        followup_sent_at=_dt(r["followup_sent_at"]),
        recruiter_email=r["recruiter_email"],
        resume_path=r["resume_path"],
        cover_letter_path=r["cover_letter_path"],
        notes=r["notes"] or "",
    )
