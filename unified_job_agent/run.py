#!/usr/bin/env python3
"""
Unified Job Application Agent — CLI entrypoint.

Usage:
  python run.py discover           # Stage 1: collect jobs
  python run.py score              # Stage 2: AI score & filter
  python run.py tailor             # Stage 3: resume + cover letter
  python run.py apply              # Stage 4: browser form submit
  python run.py email              # Stage 5: cold email outreach
  python run.py followup           # Stage 6: follow-up scheduler
  python run.py run                # All 6 stages end-to-end
  python run.py status             # Application tracker table
  python run.py reset-failed       # Reset FAILED jobs for retry
"""
import sys
import argparse
from pathlib import Path

# Ensure project root on path
sys.path.insert(0, str(Path(__file__).parent))

from core import logger
from core.state import init_db, reset_failed


def _check_prereq(stage: int):
    """Warn if previous stage may not have run."""
    prereqs = {
        2: ("Stage 1 (discover)", "jobs"),
        3: ("Stage 2 (score)", "scored_jobs"),
        4: ("Stage 3 (tailor)", "applications"),
        5: ("Stage 4 (apply)", "applications with status=APPLIED"),
        6: ("Stage 5 (email)", "applications with email_sent_at"),
    }
    msg = prereqs.get(stage)
    if msg:
        logger.info(f"Prereq: {msg[0]} should have been run first (reads '{msg[1]}' from SQLite)")


def cmd_discover(args):
    from pipeline.stage1_discover import run
    return run(dry_run=args.dry_run)


def cmd_score(args):
    _check_prereq(2)
    from pipeline.stage2_score import run
    return run(dry_run=getattr(args, "dry_run", False))


def cmd_tailor(args):
    _check_prereq(3)
    from pipeline.stage3_tailor import run
    return run(dry_run=getattr(args, "dry_run", False))


def cmd_apply(args):
    _check_prereq(4)
    from pipeline.stage4_apply import run
    return run(dry_run=args.dry_run)


def cmd_email(args):
    _check_prereq(5)
    from pipeline.stage5_cold_email import run
    return run(dry_run=args.dry_run)


def cmd_followup(args):
    _check_prereq(6)
    from pipeline.stage6_followup import run
    return run(dry_run=getattr(args, "dry_run", False))


def cmd_run(args):
    """Run all 6 stages end-to-end."""
    logger.stage("Full Pipeline — All 6 Stages")
    results = {}
    results["discover"] = cmd_discover(args)
    results["score"] = cmd_score(args)
    results["tailor"] = cmd_tailor(args)
    results["apply"] = cmd_apply(args)
    results["email"] = cmd_email(args)
    results["followup"] = cmd_followup(args)

    logger.stage("Pipeline Complete")
    for stage, count in results.items():
        logger.success(f"  {stage}: {count}")


def cmd_status(_args):
    from pipeline.stage6_followup import print_status_table
    print_status_table()


def cmd_reset_failed(_args):
    init_db()
    reset_failed()
    logger.success("All FAILED applications reset to PENDING")


# ── Parser ────────────────────────────────────────────────────────────────────

def main():
    init_db()

    parser = argparse.ArgumentParser(
        prog="python run.py",
        description="Unified Autonomous Job Application Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # discover
    p = sub.add_parser("discover", help="Stage 1: collect jobs from all sources")
    p.add_argument("--dry-run", action="store_true",
                   help="Simulate without network requests")
    p.set_defaults(func=cmd_discover)

    # score
    p = sub.add_parser("score", help="Stage 2: AI score & filter jobs")
    p.add_argument("--dry-run", action="store_true",
                   help="Use mock scores (no LLM call)")
    p.set_defaults(func=cmd_score)

    # tailor
    p = sub.add_parser("tailor", help="Stage 3: tailor resume & cover letter")
    p.add_argument("--dry-run", action="store_true",
                   help="Produce placeholder files without LLM")
    p.set_defaults(func=cmd_tailor)

    # apply
    p = sub.add_parser("apply", help="Stage 4: browser-based form submission")
    p.add_argument("--dry-run", action="store_true",
                   help="Simulate apply without opening browser")
    p.set_defaults(func=cmd_apply)

    # email
    p = sub.add_parser("email", help="Stage 5: cold email outreach")
    p.add_argument("--dry-run", action="store_true",
                   help="Generate emails without sending")
    p.set_defaults(func=cmd_email)

    # followup
    p = sub.add_parser("followup", help="Stage 6: follow-up scheduler")
    p.add_argument("--dry-run", action="store_true",
                   help="Simulate follow-ups without sending")
    p.set_defaults(func=cmd_followup)

    # run (all stages)
    p = sub.add_parser("run", help="Run all 6 stages end-to-end")
    p.add_argument("--dry-run", action="store_true",
                   help="Dry-run all stages")
    p.set_defaults(func=cmd_run)

    # status
    p = sub.add_parser("status", help="Print application tracker table")
    p.set_defaults(func=cmd_status)

    # reset-failed
    p = sub.add_parser("reset-failed", help="Reset FAILED applications to PENDING")
    p.set_defaults(func=cmd_reset_failed)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
