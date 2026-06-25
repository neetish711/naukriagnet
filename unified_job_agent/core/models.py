from __future__ import annotations
import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from enum import Enum


class Decision(str, Enum):
    APPLY = "APPLY"
    WATCH = "WATCH"
    SKIP = "SKIP"


class AppStatus(str, Enum):
    PENDING = "PENDING"
    APPLIED = "APPLIED"
    FAILED = "FAILED"
    MANUAL_REVIEW = "MANUAL_REVIEW"
    EMAIL_SENT = "EMAIL_SENT"
    FOLLOWED_UP = "FOLLOWED_UP"
    GHOSTED = "GHOSTED"


@dataclass
class Job:
    title: str
    company: str
    url: str
    description: str
    source: str
    location: str = ""
    date_posted: str = ""
    id: str = field(init=False)

    def __post_init__(self):
        self.id = hashlib.sha256(self.url.encode()).hexdigest()[:16]


@dataclass
class ScoredJob:
    job: Job
    score: float
    decision: Decision
    reason: str


@dataclass
class ApplicationRecord:
    job_id: str
    company: str
    role: str
    url: str
    source: str
    score: float
    decision: str
    status: AppStatus = AppStatus.PENDING
    applied_at: Optional[datetime] = None
    email_sent_at: Optional[datetime] = None
    followup_sent_at: Optional[datetime] = None
    recruiter_email: Optional[str] = None
    resume_path: Optional[str] = None
    cover_letter_path: Optional[str] = None
    notes: str = ""
