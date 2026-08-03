"""
benchmark.py — NETAct Copilot intent classifier benchmark runner.

Usage (standalone):
    python benchmark.py                          # run all groups
    python benchmark.py --groups G01 G06 G09    # run specific groups
    python benchmark.py --output my_results.json

The script calls classify_intent_with_ollama() from intent_router.py directly
and compares the returned intent against the expected intent in benchmark_cases.json.
Results are saved to benchmark_results.json (or --output path).
"""

import asyncio
import argparse
import json
import os
import time
import sys
from datetime import datetime

# ---------------------------------------------------------------------------
# Path setup — allow running from repo root or /backend/
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from intent_router import classify_intent_with_ollama

CASES_FILE = os.path.join(_HERE, "benchmark_cases.json")
DEFAULT_OUTPUT = os.path.join(_HERE, "benchmark_results.json")


# ---------------------------------------------------------------------------
# Core runner
# ---------------------------------------------------------------------------

async def run_case(case: dict, group_intent: str) -> dict:
    """Run a single benchmark case and return a result dict.

    Supports an optional "history" field (list of {"role", "content"} dicts)
    for regression-testing multi-turn follow-up queries — e.g. "how many are
    up?" only resolves correctly with the prior turn that established which
    device/protocol is being discussed.
    """
    query = case["query"]
    expected_intent = case.get("expected_intent", group_intent)
    expected_device = case.get("expected_device")
    history = case.get("history", [])

    t0 = time.perf_counter()
    try:
        result = await classify_intent_with_ollama(query, history=history, mode="ollama_model")
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        actual_intent = result.get("intent", "")
        actual_device = result.get("device")

        intent_pass = actual_intent == expected_intent
        device_pass = (
            True  # no device expected
            if expected_device is None
            else (
                actual_device is not None
                and expected_device.lower() in actual_device.lower()
            )
        )
        passed = intent_pass and device_pass

        return {
            "id": case["id"],
            "query": query,
            "passed": passed,
            "intent_pass": intent_pass,
            "device_pass": device_pass,
            "expected_intent": expected_intent,
            "actual_intent": actual_intent,
            "expected_device": expected_device,
            "actual_device": actual_device,
            "elapsed_ms": elapsed_ms,
            "note": case.get("note", ""),
            "error": None,
        }
    except Exception as e:
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        return {
            "id": case["id"],
            "query": query,
            "passed": False,
            "intent_pass": False,
            "device_pass": False,
            "expected_intent": expected_intent,
            "actual_intent": None,
            "expected_device": expected_device,
            "actual_device": None,
            "elapsed_ms": elapsed_ms,
            "note": case.get("note", ""),
            "error": str(e),
        }


async def run_groups(
    group_ids: list[str] | None = None,
    on_progress=None,
) -> dict:
    """
    Run benchmark for the given groups (or all groups if group_ids is None).
    on_progress(group_id, case_result) is called after each case if provided.
    Returns a full results dict.
    """
    with open(CASES_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    all_groups = data["groups"]
    if group_ids:
        all_groups = [g for g in all_groups if g["id"] in group_ids]

    group_results = []
    total_cases = 0
    total_passed = 0

    for group in all_groups:
        gid = group["id"]
        group_intent = group["intent"]
        case_results = []

        for case in group["cases"]:
            res = await run_case(case, group_intent)
            case_results.append(res)
            if on_progress:
                on_progress(gid, res)

        g_pass = sum(1 for r in case_results if r["passed"])
        g_total = len(case_results)
        total_cases += g_total
        total_passed += g_pass

        group_results.append({
            "id": gid,
            "name": group["name"],
            "intent": group_intent,
            "total": g_total,
            "passed": g_pass,
            "failed": g_total - g_pass,
            "pass_rate": round(g_pass / g_total * 100, 1) if g_total else 0,
            "cases": case_results,
        })

    return {
        "run_at": datetime.utcnow().isoformat() + "Z",
        "groups_run": [g["id"] for g in all_groups],
        "total_cases": total_cases,
        "total_passed": total_passed,
        "total_failed": total_cases - total_passed,
        "overall_pass_rate": round(total_passed / total_cases * 100, 1) if total_cases else 0,
        "groups": group_results,
    }


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def cli():
    parser = argparse.ArgumentParser(description="NETAct intent classifier benchmark")
    parser.add_argument(
        "--groups",
        nargs="*",
        metavar="GXX",
        help="Group IDs to run (e.g. G01 G06 G09). Omit to run all.",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Path to write results JSON (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress per-case output",
    )
    args = parser.parse_args()

    def on_progress(group_id, res):
        if args.quiet:
            return
        status = "✅ PASS" if res["passed"] else "❌ FAIL"
        intent_info = f"{res['expected_intent']} → {res['actual_intent']}"
        print(f"  [{group_id}] {res['id']}: {status}  ({intent_info})  {res['elapsed_ms']}ms")
        if not res["passed"] and res["error"]:
            print(f"    ERROR: {res['error']}")
        if not res["intent_pass"]:
            print(f"    INTENT mismatch: expected={res['expected_intent']}  got={res['actual_intent']}")
        if not res["device_pass"]:
            print(f"    DEVICE mismatch: expected={res['expected_device']}  got={res['actual_device']}")

    print(f"\n{'='*60}")
    print("  NETAct Intent Classifier Benchmark")
    print(f"{'='*60}")
    if args.groups:
        print(f"  Groups: {', '.join(args.groups)}")
    else:
        print("  Groups: ALL")
    print()

    results = asyncio.run(run_groups(args.groups, on_progress=on_progress))

    # Save results
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    # Print summary
    print(f"\n{'='*60}")
    print(f"  SUMMARY")
    print(f"{'='*60}")
    for g in results["groups"]:
        bar_filled = int(g["pass_rate"] / 5)
        bar = "█" * bar_filled + "░" * (20 - bar_filled)
        print(f"  {g['id']} {g['name'][:30]:<30} [{bar}] {g['pass_rate']:5.1f}%  ({g['passed']}/{g['total']})")
    print(f"\n  Overall: {results['overall_pass_rate']}%  ({results['total_passed']}/{results['total_cases']} cases)")
    print(f"  Results saved → {args.output}\n")


if __name__ == "__main__":
    cli()
