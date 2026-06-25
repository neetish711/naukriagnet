"""Stage 1 — Discover & Deduplicate jobs from multiple sources."""
from __future__ import annotations
import sys
import time
import random
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional
import yaml

# Make sure project root is importable
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.models import Job
from core.state import init_db, save_job
from core import logger


# ── Config ────────────────────────────────────────────────────────────────────

def _load_profile() -> dict:
    path = Path(__file__).parent.parent / "config" / "profile.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


# ── Collectors ────────────────────────────────────────────────────────────────

def _collect_linkedin(titles: List[str], locations: List[str],
                      dry_run: bool = False) -> List[Job]:
    """Collect LinkedIn jobs via python-jobspy."""
    jobs: List[Job] = []
    if dry_run:
        logger.info("  [dry-run] LinkedIn collector skipped")
        return [Job(title="AI Engineer (mock)", company="MockCo", url="https://linkedin.com/jobs/1",
                    description="Mock LinkedIn job for dry-run.", source="linkedin",
                    location="Remote", date_posted="2024-01-01")]
    try:
        from jobspy import scrape_jobs  # type: ignore
        import pandas as pd

        for title in titles:
            for loc in locations:
                try:
                    df = scrape_jobs(
                        site_name=["linkedin"],
                        search_term=title,
                        location=loc,
                        results_wanted=20,
                        hours_old=72,
                    )
                    for _, row in df.iterrows():
                        if not row.get("job_url"):
                            continue
                        jobs.append(Job(
                            title=str(row.get("title", "")),
                            company=str(row.get("company", "")),
                            url=str(row["job_url"]),
                            description=str(row.get("description", "")),
                            source="linkedin",
                            location=str(row.get("location", "")),
                            date_posted=str(row.get("date_posted", "")),
                        ))
                    time.sleep(random.uniform(1, 3))
                except Exception as e:
                    logger.warning(f"  LinkedIn [{title}/{loc}]: {e}")
    except ImportError:
        logger.warning("  jobspy not installed — LinkedIn collector skipped")
    return jobs


def _collect_naukri(titles: List[str], locations: List[str],
                    dry_run: bool = False) -> List[Job]:
    """Collect Naukri jobs via python-jobspy."""
    jobs: List[Job] = []
    if dry_run:
        logger.info("  [dry-run] Naukri collector skipped")
        return [Job(title="ML Engineer (mock)", company="MockStartup", url="https://naukri.com/jobs/1",
                    description="Mock Naukri job for dry-run.", source="naukri",
                    location="Bangalore", date_posted="2024-01-01")]
    try:
        from jobspy import scrape_jobs  # type: ignore

        for title in titles:
            for loc in locations:
                try:
                    df = scrape_jobs(
                        site_name=["indeed"],
                        search_term=title,
                        location=loc if loc != "Remote" else "India",
                        results_wanted=15,
                        hours_old=72,
                    )
                    for _, row in df.iterrows():
                        if not row.get("job_url"):
                            continue
                        jobs.append(Job(
                            title=str(row.get("title", "")),
                            company=str(row.get("company", "")),
                            url=str(row["job_url"]),
                            description=str(row.get("description", "")),
                            source="naukri",
                            location=str(row.get("location", "")),
                            date_posted=str(row.get("date_posted", "")),
                        ))
                    time.sleep(random.uniform(1, 2))
                except Exception as e:
                    logger.warning(f"  Naukri [{title}/{loc}]: {e}")
    except ImportError:
        logger.warning("  jobspy not installed — Naukri/Indeed collector skipped")
    return jobs


def _collect_ycombinator(titles: List[str], dry_run: bool = False) -> List[Job]:
    """Scrape YCombinator Work at a Startup."""
    jobs: List[Job] = []
    if dry_run:
        logger.info("  [dry-run] YC collector skipped")
        return [Job(title="Software Engineer (mock)", company="YC Startup",
                    url="https://workatastartup.com/jobs/1",
                    description="Mock YC job.", source="ycombinator",
                    location="Remote", date_posted="2024-01-01")]
    try:
        import requests
        from bs4 import BeautifulSoup

        keywords = " ".join(titles[:3])
        url = f"https://www.workatastartup.com/jobs?q={requests.utils.quote(keywords)}"
        resp = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        soup = BeautifulSoup(resp.text, "html.parser")
        for card in soup.select("div.job-name")[:30]:
            link = card.find("a")
            if not link:
                continue
            href = "https://www.workatastartup.com" + link.get("href", "")
            title = link.get_text(strip=True)
            company_tag = card.find_next("a", class_="company-name")
            company = company_tag.get_text(strip=True) if company_tag else "Unknown"
            jobs.append(Job(
                title=title, company=company, url=href,
                description="", source="ycombinator", location="Remote"
            ))
    except Exception as e:
        logger.warning(f"  YC collector: {e}")
    return jobs


def _collect_wellfound(titles: List[str], dry_run: bool = False) -> List[Job]:
    """Scrape Wellfound (AngelList) job listings."""
    jobs: List[Job] = []
    if dry_run:
        logger.info("  [dry-run] Wellfound collector skipped")
        return [Job(title="AI Engineer (mock)", company="Wellfound Startup",
                    url="https://wellfound.com/jobs/1",
                    description="Mock Wellfound job.", source="wellfound",
                    location="Remote", date_posted="2024-01-01")]
    try:
        import requests
        from bs4 import BeautifulSoup

        for title in titles[:2]:
            url = f"https://wellfound.com/jobs?q={requests.utils.quote(title)}"
            resp = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
            soup = BeautifulSoup(resp.text, "html.parser")
            for card in soup.select("a[data-test='JobListing']")[:15]:
                href = card.get("href", "")
                if not href.startswith("http"):
                    href = "https://wellfound.com" + href
                title_tag = card.select_one("h2")
                company_tag = card.select_one("span[class*='company']")
                jobs.append(Job(
                    title=title_tag.get_text(strip=True) if title_tag else title,
                    company=company_tag.get_text(strip=True) if company_tag else "Unknown",
                    url=href,
                    description="",
                    source="wellfound",
                    location="Remote",
                ))
            time.sleep(random.uniform(1, 2))
    except Exception as e:
        logger.warning(f"  Wellfound collector: {e}")
    return jobs


def _collect_github_jobs(titles: List[str], dry_run: bool = False) -> List[Job]:
    """Collect jobs via GitHub Jobs API (remotive.io as public alternative)."""
    jobs: List[Job] = []
    if dry_run:
        logger.info("  [dry-run] Remote/GitHub jobs collector skipped")
        return [Job(title="Python Engineer (mock)", company="Remote Co",
                    url="https://remotive.com/jobs/1",
                    description="Mock remote job.", source="github_remote",
                    location="Remote", date_posted="2024-01-01")]
    try:
        import requests

        for title in titles[:3]:
            resp = requests.get(
                "https://remotive.com/api/remote-jobs",
                params={"search": title, "limit": 20},
                timeout=15,
            )
            data = resp.json().get("jobs", [])
            for item in data:
                jobs.append(Job(
                    title=item.get("title", ""),
                    company=item.get("company_name", ""),
                    url=item.get("url", ""),
                    description=item.get("description", ""),
                    source="github_remote",
                    location=item.get("candidate_required_location", "Remote"),
                    date_posted=item.get("publication_date", ""),
                ))
            time.sleep(random.uniform(0.5, 1.5))
    except Exception as e:
        logger.warning(f"  Remote jobs collector: {e}")
    return jobs


# ── Main Stage ────────────────────────────────────────────────────────────────

def run(dry_run: bool = False) -> int:
    """Run Stage 1. Returns count of new jobs saved."""
    logger.stage("Stage 1 — Discover & Deduplicate")
    init_db()

    profile = _load_profile()
    prefs = profile.get("job_preferences", {})
    titles: List[str] = prefs.get("titles", ["Software Engineer"])
    locations: List[str] = prefs.get("locations", ["Remote"])
    bad_words: List[str] = [w.lower() for w in prefs.get("bad_words", [])]

    collectors = [
        ("LinkedIn",       lambda: _collect_linkedin(titles, locations, dry_run)),
        ("Naukri/Indeed",  lambda: _collect_naukri(titles, locations, dry_run)),
        ("YCombinator",    lambda: _collect_ycombinator(titles, dry_run)),
        ("Wellfound",      lambda: _collect_wellfound(titles, dry_run)),
        ("Remote/GitHub",  lambda: _collect_github_jobs(titles, dry_run)),
    ]

    all_jobs: List[Job] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fn): name for name, fn in collectors}
        with logger.make_progress() as progress:
            task = progress.add_task("Collecting jobs...", total=len(futures))
            for future in as_completed(futures):
                name = futures[future]
                try:
                    result = future.result()
                    all_jobs.extend(result)
                    logger.info(f"  {name}: {len(result)} jobs found")
                except Exception as e:
                    logger.error(f"  {name} failed: {e}")
                progress.advance(task)

    logger.info(f"Total collected (before dedup): {len(all_jobs)}")

    # Filter bad words
    filtered = []
    for job in all_jobs:
        combined = (job.title + " " + job.description).lower()
        if any(bw in combined for bw in bad_words):
            continue
        filtered.append(job)

    logger.info(f"After bad-word filter: {len(filtered)}")

    # Deduplicate + persist
    new_count = 0
    for job in filtered:
        if save_job(job):
            new_count += 1

    logger.success(f"Stage 1 complete — {new_count} new jobs saved (skipped {len(filtered) - new_count} duplicates)")
    return new_count


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
