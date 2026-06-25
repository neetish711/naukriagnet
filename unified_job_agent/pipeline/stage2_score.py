"""Stage 2 — AI Score & Filter jobs using LLM (Ollama / OpenAI fallback)."""
from __future__ import annotations
import os
import sys
import json
from pathlib import Path
from typing import List, Tuple
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.models import Job, ScoredJob, Decision
from core.state import init_db, get_undecided_jobs, save_score
from core import logger


# ── Config ────────────────────────────────────────────────────────────────────

def _load_config() -> Tuple[dict, dict]:
    base = Path(__file__).parent.parent / "config"
    with open(base / "profile.yaml") as f:
        profile = yaml.safe_load(f)
    with open(base / "secrets.yaml") as f:
        secrets = yaml.safe_load(f)
    return profile, secrets


# ── LLM clients ───────────────────────────────────────────────────────────────

def _score_with_ollama(prompt: str, model: str) -> str:
    import ollama  # type: ignore
    resp = ollama.chat(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        options={"temperature": 0.1},
    )
    return resp["message"]["content"]


def _score_with_openai(prompt: str, api_key: str) -> str:
    from openai import OpenAI  # type: ignore
    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )
    return resp.choices[0].message.content or ""


def _call_llm(prompt: str, secrets: dict) -> str:
    openai_key = secrets.get("openai_api_key") or os.environ.get("OPENAI_API_KEY", "")
    if openai_key:
        try:
            return _score_with_openai(prompt, openai_key)
        except Exception as e:
            logger.warning(f"  OpenAI failed ({e}), falling back to Ollama")

    model = secrets.get("ollama_model", "llama3.1:8b")
    try:
        return _score_with_ollama(prompt, model)
    except Exception as e:
        raise RuntimeError(f"All LLM backends failed. Last error: {e}")


# ── Scoring logic ─────────────────────────────────────────────────────────────

_SCORE_PROMPT = """You are a precise job-fit scoring assistant.

Candidate profile:
- Desired titles: {titles}
- Locations: {locations}
- Good keywords: {good_words}
- Experience summary: {experience_summary}
- Skills: {skills}

Job posting:
Title: {title}
Company: {company}
Location: {location}
Description (first 800 chars):
{description}

Task: Score this job's fit for the candidate on a scale of 1-10 where:
- 10 = perfect match (title, skills, location, seniority all align)
- 7-9 = strong match, worth applying
- 4-6 = partial match, needs consideration
- 1-3 = poor match, skip

Also give a decision: APPLY (score >= 7), WATCH (score 5-6), or SKIP (score <= 4).

Respond ONLY with valid JSON, no markdown:
{{"score": <number>, "decision": "<APPLY|WATCH|SKIP>", "reason": "<one sentence>"}}"""


def _build_prompt(job: Job, profile: dict) -> str:
    prefs = profile.get("job_preferences", {})
    return _SCORE_PROMPT.format(
        titles=", ".join(prefs.get("titles", [])),
        locations=", ".join(prefs.get("locations", [])),
        good_words=", ".join(prefs.get("good_words", [])),
        experience_summary=profile.get("experience_summary", "Not provided"),
        skills=", ".join(profile.get("skills", [])),
        title=job.title,
        company=job.company,
        location=job.location,
        description=job.description[:800],
    )


def _parse_llm_response(raw: str) -> Tuple[float, Decision, str]:
    raw = raw.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = "\n".join(raw.split("\n")[1:])
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    try:
        data = json.loads(raw)
        score = float(data.get("score", 5))
        decision_str = str(data.get("decision", "SKIP")).upper()
        decision = Decision[decision_str] if decision_str in Decision.__members__ else Decision.SKIP
        reason = str(data.get("reason", ""))
        return score, decision, reason
    except (json.JSONDecodeError, KeyError):
        logger.warning(f"  Failed to parse LLM response: {raw[:100]}")
        return 5.0, Decision.WATCH, "Could not parse LLM response"


# ── Main Stage ────────────────────────────────────────────────────────────────

def run(dry_run: bool = False) -> int:
    """Run Stage 2. Returns count of APPLY decisions."""
    logger.stage("Stage 2 — AI Score & Filter")
    init_db()

    profile, secrets = _load_config()
    min_score = profile.get("job_preferences", {}).get("min_score", 7)

    jobs = get_undecided_jobs()
    if not jobs:
        logger.info("No undecided jobs to score (run Stage 1 first, or all jobs already scored)")
        return 0

    logger.info(f"Scoring {len(jobs)} jobs...")

    apply_count = 0
    with logger.make_progress() as progress:
        task = progress.add_task("Scoring jobs...", total=len(jobs))
        for job in jobs:
            if dry_run:
                score, decision, reason = 8.0, Decision.APPLY, "Dry-run mock score"
            else:
                prompt = _build_prompt(job, profile)
                try:
                    raw = _call_llm(prompt, secrets)
                    score, decision, reason = _parse_llm_response(raw)
                except Exception as e:
                    logger.error(f"  LLM error for {job.title} @ {job.company}: {e}")
                    score, decision, reason = 5.0, Decision.SKIP, f"LLM error: {e}"

            # Override decision based on min_score threshold
            if score >= min_score and decision == Decision.WATCH:
                decision = Decision.APPLY
            elif score < min_score and decision == Decision.APPLY:
                decision = Decision.WATCH

            scored = ScoredJob(job=job, score=score, decision=decision, reason=reason)
            save_score(scored)

            if decision == Decision.APPLY:
                apply_count += 1
                logger.success(f"  APPLY [{score:.1f}] {job.title} @ {job.company} — {reason}")
            elif decision == Decision.WATCH:
                logger.info(f"  WATCH [{score:.1f}] {job.title} @ {job.company}")
            else:
                logger.info(f"  SKIP  [{score:.1f}] {job.title} @ {job.company}")

            progress.advance(task)

    logger.success(f"Stage 2 complete — {apply_count} APPLY decisions from {len(jobs)} jobs")
    return apply_count


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
