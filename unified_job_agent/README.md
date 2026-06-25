# Unified Autonomous Job Application Agent

A 6-stage agentic pipeline that discovers jobs, scores them with AI, tailors your resume & cover letter, applies autonomously via browser automation, sends personalised cold emails to recruiters, and tracks follow-ups — all from a single CLI.

---

## Setup (5 Steps)

```bash
# 1. Clone and enter project
git clone <repo-url> && cd unified_job_agent

# 2. Create a virtual environment
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt
playwright install chromium   # for non-LinkedIn apply

# 4. Fill in your profile and secrets
#    Edit config/profile.yaml  — name, resume path, job preferences
#    Edit config/secrets.yaml  — API keys, SMTP credentials, LinkedIn login

# 5. Drop your resume PDF at  assets/resume.pdf
#    (create the assets/ folder if needed)
```

---

## Configuration Guide

### `config/profile.yaml`
| Field | Description |
|---|---|
| `personal.*` | Your name, email, phone, LinkedIn, GitHub, location |
| `resume_path` | Relative path to your base PDF resume |
| `job_preferences.titles` | Job titles to search for |
| `job_preferences.locations` | Preferred locations (use "Remote" for WFH) |
| `job_preferences.min_score` | Minimum AI score (1-10) to auto-apply |
| `job_preferences.bad_words` | Keywords that disqualify a listing |
| `experience_summary` | 3-5 sentence background summary (feeds LLM) |
| `skills` | Your skills list (feeds ATS keyword matching) |

### `config/secrets.yaml`
| Key | Description |
|---|---|
| `openai_api_key` | OpenAI key (optional; Ollama used if absent) |
| `ollama_model` | Ollama model name (default: `llama3.1:8b`) |
| `hunter_api_key` | Hunter.io key for recruiter email lookup |
| `smtp_*` | Gmail / SMTP credentials for sending emails |
| `linkedin_email/password` | LinkedIn credentials for Easy Apply |

> **Security:** `secrets.yaml` is in `.gitignore`. Never commit real values.

---

## Running the Pipeline

```bash
# Individual stages
python run.py discover          # Stage 1: Collect jobs from LinkedIn, Naukri, YC, Wellfound, Remote
python run.py score             # Stage 2: AI scores each job 1-10, decides APPLY/WATCH/SKIP
python run.py tailor            # Stage 3: Tailor resume + cover letter per job
python run.py apply             # Stage 4: Browser automation (LinkedIn Easy Apply + Playwright)
python run.py email             # Stage 5: Find recruiter email + send cold outreach
python run.py followup          # Stage 6: Send follow-ups at day 3, mark GHOSTED at day 7

# Full pipeline
python run.py run               # Runs all 6 stages sequentially

# Utility
python run.py status            # Rich table: Company | Role | Applied | Email | Status | Days
python run.py reset-failed      # Reset FAILED jobs for retry

# Dry-run (safe testing — no browser, no email, no LLM for stages 1/4/5)
python run.py discover --dry-run
python run.py run --dry-run
```

---

## Stage Descriptions

**Stage 1 — Discover & Deduplicate**
Scrapes jobs in parallel from LinkedIn (via python-jobspy), Naukri/Indeed, YCombinator Work at a Startup, Wellfound, and Remotive.io. Deduplicates by URL hash stored in SQLite. Filters out listings containing bad keywords before saving.

**Stage 2 — AI Score & Filter**
Sends each unscored job to an LLM (Ollama llama3.1:8b by default, OpenAI gpt-4o-mini if key present) with a structured prompt that evaluates fit against your resume, desired titles, and good/bad word lists. Scores 1-10; jobs ≥ 7 receive an APPLY decision. All decisions are logged to SQLite.

**Stage 3 — Resume & Cover Letter Tailoring**
For each APPLY job: extracts ATS keywords from the job description, rewrites your resume to emphasise relevant experience (never fabricating anything), and generates a personalised 3-paragraph cover letter mentioning the specific company. Outputs are saved as `outputs/{company}_{role}_resume.pdf` and `outputs/{company}_{role}_cover.txt`.

**Stage 4 — Autonomous Browser Apply**
Submits applications automatically. LinkedIn jobs use Selenium + undetected-chromedriver to click Easy Apply, navigate multi-step forms, upload the tailored resume, and answer screening questions via LLM. Non-LinkedIn jobs use Playwright to detect and fill form fields. Retries up to 2 times on failure; marks as MANUAL_REVIEW after that. Respects 5-15s random delays and a per-session cap of 30 applications.

**Stage 5 — Cold Email Outreach**
For every submitted application: locates the hiring manager or recruiter email (Hunter.io first, then SMTP-verified pattern generation). Uses the LLM to write a 3-sentence cold email (who you are, one achievement, one ask). Attaches the tailored resume and sends via Gmail SMTP / SendGrid.

**Stage 6 — Follow-Up & Tracking**
Checks email timestamps daily: sends one concise follow-up at day 3, marks the application as GHOSTED at day 7 with no reply. The `status` command renders a live Rich table covering every application's full lifecycle.
