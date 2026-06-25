"""Stage 4 — Autonomous Browser Apply.

LinkedIn Easy Apply: Selenium (ported from AIHawk automation)
Other job boards: Playwright generic form-filler
"""
from __future__ import annotations
import os
import sys
import time
import random
from datetime import datetime
from pathlib import Path
from typing import Optional
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.models import ApplicationRecord, AppStatus
from core.state import init_db, get_applications, upsert_application
from core import logger


# ── Config ────────────────────────────────────────────────────────────────────

def _load_config():
    base = Path(__file__).parent.parent / "config"
    with open(base / "profile.yaml") as f:
        profile = yaml.safe_load(f)
    with open(base / "secrets.yaml") as f:
        secrets = yaml.safe_load(f)
    return profile, secrets


def _random_delay(lo: float = 5.0, hi: float = 15.0):
    time.sleep(random.uniform(lo, hi))


# ── LLM answer helper ─────────────────────────────────────────────────────────

def _answer_question(question: str, profile: dict, secrets: dict) -> str:
    """Use LLM to answer a screening question based on profile."""
    prompt = (
        f"You are filling out a job application form. "
        f"Answer the following question truthfully based on this candidate profile:\n\n"
        f"Profile: {yaml.dump(profile.get('personal', {}))}\n"
        f"Skills: {', '.join(profile.get('skills', []))}\n"
        f"Experience: {profile.get('experience_summary', '')}\n\n"
        f"Question: {question}\n\n"
        f"Provide a concise, professional answer (1-2 sentences max). "
        f"If it's a yes/no question, answer Yes or No first then explain briefly."
    )
    openai_key = secrets.get("openai_api_key") or os.environ.get("OPENAI_API_KEY", "")
    if openai_key:
        try:
            from openai import OpenAI  # type: ignore
            client = OpenAI(api_key=openai_key)
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
            )
            return resp.choices[0].message.content or ""
        except Exception:
            pass
    model = secrets.get("ollama_model", "llama3.1:8b")
    try:
        import ollama  # type: ignore
        resp = ollama.chat(model=model,
                           messages=[{"role": "user", "content": prompt}],
                           options={"temperature": 0.2})
        return resp["message"]["content"]
    except Exception:
        return "Yes"  # Safe fallback for boolean questions


# ── LinkedIn Easy Apply (Selenium) ────────────────────────────────────────────

def _linkedin_easy_apply(rec: ApplicationRecord, profile: dict, secrets: dict,
                          dry_run: bool) -> bool:
    """Navigate LinkedIn Easy Apply flow and submit application."""
    if dry_run:
        logger.info(f"  [dry-run] Would apply via LinkedIn Easy Apply: {rec.url}")
        return True

    try:
        from selenium import webdriver  # type: ignore
        from selenium.webdriver.common.by import By  # type: ignore
        from selenium.webdriver.support.ui import WebDriverWait, Select  # type: ignore
        from selenium.webdriver.support import expected_conditions as EC  # type: ignore
        from selenium.webdriver.chrome.options import Options  # type: ignore
        import undetected_chromedriver as uc  # type: ignore
    except ImportError as e:
        logger.error(f"  Selenium/undetected-chromedriver not installed: {e}")
        return False

    options = uc.ChromeOptions()
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    # options.add_argument("--headless")  # Uncomment for headless mode

    driver = None
    try:
        driver = uc.Chrome(options=options)
        wait = WebDriverWait(driver, 15)

        # Login to LinkedIn
        driver.get("https://www.linkedin.com/login")
        time.sleep(2)
        driver.find_element(By.ID, "username").send_keys(secrets.get("linkedin_email", ""))
        driver.find_element(By.ID, "password").send_keys(secrets.get("linkedin_password", ""))
        driver.find_element(By.CSS_SELECTOR, "button[type='submit']").click()
        time.sleep(3)

        # Navigate to job
        driver.get(rec.url)
        _random_delay(3, 6)

        # Click Easy Apply button
        easy_apply_btn = wait.until(
            EC.element_to_be_clickable(
                (By.CSS_SELECTOR, "button.jobs-apply-button, .jobs-s-apply button")
            )
        )
        easy_apply_btn.click()
        _random_delay(2, 4)

        # Multi-step form navigation
        for step in range(10):
            # Upload resume if prompted
            upload_inputs = driver.find_elements(By.CSS_SELECTOR, "input[type='file']")
            if upload_inputs and rec.resume_path and Path(rec.resume_path).exists():
                upload_inputs[0].send_keys(str(Path(rec.resume_path).resolve()))
                _random_delay(1, 2)

            # Fill text inputs using profile data
            personal = profile.get("personal", {})
            field_map = {
                "phone": personal.get("phone", ""),
                "city": personal.get("location", ""),
                "linkedin": personal.get("linkedin", ""),
                "website": personal.get("github", ""),
            }
            for label_text, value in field_map.items():
                if not value:
                    continue
                try:
                    inputs = driver.find_elements(
                        By.XPATH,
                        f"//label[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ',"
                        f"'abcdefghijklmnopqrstuvwxyz'),'{label_text}')]/following-sibling::input"
                    )
                    for inp in inputs:
                        if not inp.get_attribute("value"):
                            inp.clear()
                            inp.send_keys(value)
                except Exception:
                    pass

            # Handle screening questions via LLM
            question_elements = driver.find_elements(
                By.CSS_SELECTOR, "span.jobs-easy-apply-form-element label"
            )
            for q_elem in question_elements:
                q_text = q_elem.text.strip()
                if not q_text or len(q_text) < 5:
                    continue
                answer = _answer_question(q_text, profile, secrets)
                try:
                    # Find adjacent input
                    parent = q_elem.find_element(By.XPATH, "..")
                    inp = parent.find_element(By.CSS_SELECTOR, "input, textarea, select")
                    tag = inp.tag_name.lower()
                    if tag == "select":
                        sel = Select(inp)
                        try:
                            sel.select_by_visible_text(answer.split()[0])
                        except Exception:
                            sel.select_by_index(0)
                    elif tag in ("input", "textarea"):
                        inp.clear()
                        inp.send_keys(answer[:500])
                except Exception:
                    pass

            # Next / Submit
            try:
                submit_btn = driver.find_element(
                    By.CSS_SELECTOR,
                    "button[aria-label='Submit application'], "
                    "button[aria-label='Review your application']"
                )
                submit_btn.click()
                _random_delay(2, 4)
                # Check for success modal
                if driver.find_elements(By.CSS_SELECTOR, ".artdeco-modal__header h2"):
                    header = driver.find_element(
                        By.CSS_SELECTOR, ".artdeco-modal__header h2"
                    ).text
                    if "submitted" in header.lower() or "sent" in header.lower():
                        return True
                break
            except Exception:
                pass

            try:
                next_btn = driver.find_element(
                    By.CSS_SELECTOR,
                    "button[aria-label='Continue to next step']"
                )
                next_btn.click()
                _random_delay(1, 3)
            except Exception:
                break  # No more steps

        return True

    except Exception as e:
        logger.error(f"  LinkedIn Easy Apply error: {e}")
        return False
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass


# ── Playwright generic apply ───────────────────────────────────────────────────

def _playwright_apply(rec: ApplicationRecord, profile: dict, secrets: dict,
                      dry_run: bool) -> bool:
    """Generic form-fill apply for non-LinkedIn jobs via Playwright."""
    if dry_run:
        logger.info(f"  [dry-run] Would apply via Playwright: {rec.url}")
        return True

    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError:
        logger.error("  playwright not installed")
        return False

    personal = profile.get("personal", {})

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True,
                                    executable_path="/opt/pw-browsers/chromium")
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        try:
            page.goto(rec.url, wait_until="networkidle", timeout=30000)
            _random_delay(2, 4)

            # Common field patterns
            fill_map = {
                'input[name*="name"], input[placeholder*="name" i]':
                    personal.get("name", ""),
                'input[name*="email"], input[type="email"]':
                    personal.get("email", ""),
                'input[name*="phone"], input[type="tel"]':
                    personal.get("phone", ""),
                'input[name*="linkedin"], input[placeholder*="linkedin" i]':
                    personal.get("linkedin", ""),
                'input[name*="github"], input[placeholder*="github" i]':
                    personal.get("github", ""),
                'input[name*="location"], input[placeholder*="city" i]':
                    personal.get("location", ""),
            }

            for selector, value in fill_map.items():
                if not value:
                    continue
                for locator in page.locator(selector).all():
                    try:
                        if not locator.input_value():
                            locator.fill(value)
                    except Exception:
                        pass

            # Upload resume
            if rec.resume_path and Path(rec.resume_path).exists():
                file_inputs = page.locator("input[type='file']").all()
                for fi in file_inputs:
                    try:
                        fi.set_input_files(str(Path(rec.resume_path).resolve()))
                        break
                    except Exception:
                        pass

            # Look for cover letter textarea
            if rec.cover_letter_path and Path(rec.cover_letter_path).exists():
                cover_text = Path(rec.cover_letter_path).read_text()
                for ta in page.locator("textarea").all():
                    try:
                        label = ta.get_attribute("aria-label") or ""
                        placeholder = ta.get_attribute("placeholder") or ""
                        if "cover" in (label + placeholder).lower():
                            ta.fill(cover_text[:2000])
                            break
                    except Exception:
                        pass

            # Submit
            submit_selectors = [
                "button[type='submit']",
                "input[type='submit']",
                "button:has-text('Submit')",
                "button:has-text('Apply')",
            ]
            submitted = False
            for sel in submit_selectors:
                btn = page.locator(sel).first
                if btn.is_visible():
                    btn.click()
                    _random_delay(2, 4)
                    submitted = True
                    break

            return submitted

        except Exception as e:
            logger.error(f"  Playwright apply error: {e}")
            return False
        finally:
            browser.close()


# ── Main Stage ────────────────────────────────────────────────────────────────

def run(dry_run: bool = False) -> int:
    """Run Stage 4. Returns count of successful submissions."""
    logger.stage("Stage 4 — Autonomous Browser Apply")
    init_db()

    profile, secrets = _load_config()
    max_apps = profile.get("job_preferences", {}).get("max_daily_applications", 30)

    # Get tailored (PENDING) applications
    pending = [r for r in get_applications() if r.status == AppStatus.PENDING]

    if not pending:
        logger.info("No PENDING applications to submit (run Stages 1-3 first)")
        return 0

    pending = pending[:max_apps]
    logger.info(f"Submitting up to {len(pending)} applications...")

    submitted = 0
    with logger.make_progress() as progress:
        task = progress.add_task("Applying...", total=len(pending))

        for rec in pending:
            is_linkedin = "linkedin.com" in rec.url.lower()
            retries = 0
            success = False

            while retries <= 2 and not success:
                try:
                    if is_linkedin:
                        success = _linkedin_easy_apply(rec, profile, secrets, dry_run)
                    else:
                        success = _playwright_apply(rec, profile, secrets, dry_run)
                except Exception as e:
                    logger.warning(f"  Attempt {retries+1} failed for {rec.company}: {e}")
                    retries += 1
                    if retries <= 2:
                        _random_delay(3, 6)

            if success:
                rec.status = AppStatus.APPLIED
                rec.applied_at = datetime.now()
                logger.success(f"  Applied: {rec.role} @ {rec.company}")
                submitted += 1
            else:
                if retries > 2:
                    rec.status = AppStatus.MANUAL_REVIEW
                    rec.notes = "Failed after 2 retries"
                    logger.warning(f"  MANUAL_REVIEW: {rec.role} @ {rec.company}")
                else:
                    rec.status = AppStatus.FAILED
                    rec.notes = "Apply failed"

            upsert_application(rec)

            if not dry_run:
                _random_delay(5, 15)  # Rate limiting

            progress.advance(task)

    logger.success(f"Stage 4 complete — {submitted} applications submitted")
    return submitted


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
