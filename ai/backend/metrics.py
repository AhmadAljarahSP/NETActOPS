"""
Copilot AI Metrics
==================
Tracks Gemini API calls and local model escalation events.
Exposed at GET /metrics in Prometheus text format.
"""
from prometheus_client import (
    Counter, Histogram, Gauge,
    generate_latest, CONTENT_TYPE_LATEST,
)

# ── Gemini API metrics ──────────────────────────────────────────────────────

gemini_requests = Counter(
    "copilot_gemini_requests_total",
    "Total Gemini API calls made",
    ["model", "status"],          # status: success | error
)

gemini_duration = Histogram(
    "copilot_gemini_request_duration_seconds",
    "Gemini API end-to-end latency",
    ["model"],
    buckets=[0.5, 1, 2, 5, 10, 20, 30, 60],
)

gemini_input_tokens = Counter(
    "copilot_gemini_input_tokens_total",
    "Gemini prompt (input) tokens consumed",
    ["model"],
)

gemini_output_tokens = Counter(
    "copilot_gemini_output_tokens_total",
    "Gemini output (response) tokens generated",
    ["model"],
)

gemini_total_tokens = Counter(
    "copilot_gemini_total_tokens_total",
    "Total Gemini tokens (input + output)",
    ["model"],
)

# ── Escalation event metrics ────────────────────────────────────────────────

escalations_triggered = Counter(
    "copilot_escalations_triggered_total",
    "Times local model answered with low confidence and Gemini was offered",
)

escalations_confirmed = Counter(
    "copilot_escalations_confirmed_total",
    "Times operator confirmed to send query to Gemini",
)

escalations_rejected = Counter(
    "copilot_escalations_rejected_total",
    "Times operator rejected Gemini escalation (kept local answer)",
)

# ── Local model confidence metrics ─────────────────────────────────────────

local_confidence_counts = Counter(
    "copilot_local_confidence_total",
    "Local model confidence distribution",
    ["level"],    # HIGH | MEDIUM | LOW
)

# ── Helpers called from agent.py / app.py ──────────────────────────────────

def record_gemini_call(model: str, duration_s: float, status: str,
                       input_tokens: int = 0, output_tokens: int = 0):
    """Call this after every Gemini API attempt."""
    gemini_requests.labels(model=model, status=status).inc()
    gemini_duration.labels(model=model).observe(duration_s)
    if status == "success":
        gemini_input_tokens.labels(model=model).inc(input_tokens)
        gemini_output_tokens.labels(model=model).inc(output_tokens)
        gemini_total_tokens.labels(model=model).inc(input_tokens + output_tokens)


def record_escalation_triggered():
    escalations_triggered.inc()


def record_escalation_confirmed():
    escalations_confirmed.inc()


def record_escalation_rejected():
    escalations_rejected.inc()


def record_local_confidence(level: str):
    """level should be 'HIGH', 'MEDIUM', or 'LOW'."""
    local_confidence_counts.labels(level=level.upper()).inc()


# ── Sync/Ingestion metrics ──────────────────────────────────────────────────

sync_total_chunks = Gauge(
    "copilot_sync_total_chunks",
    "Total chunks identified for knowledgebase sync",
)

sync_success_chunks = Gauge(
    "copilot_sync_success_chunks",
    "Successfully embedded chunks in current sync run",
)

sync_failed_chunks = Gauge(
    "copilot_sync_failed_chunks",
    "Failed/dummy-vector embedded chunks in current sync run",
)

sync_estimated_time_remaining = Gauge(
    "copilot_sync_estimated_time_remaining_seconds",
    "Estimated remaining time in seconds for the current sync run",
)

sync_completion_percentage = Gauge(
    "copilot_sync_completion_percentage",
    "Percentage of sync completion (0-100)",
)


# ── Benchmark accuracy metrics ──────────────────────────────────────────────

benchmark_overall_pass_rate = Gauge(
    "copilot_benchmark_pass_rate",
    "Overall intent classifier benchmark pass rate (0-100) from the last run",
)

benchmark_group_pass_rate = Gauge(
    "copilot_benchmark_group_pass_rate",
    "Per-group benchmark pass rate (0-100) from the last run",
    ["group_id", "group_name"],
)

import time as _time

benchmark_last_run_timestamp = Gauge(
    "copilot_benchmark_last_run_timestamp",
    "Unix timestamp of the last benchmark run",
)
benchmark_last_run_timestamp.set(_time.time())

benchmark_total_cases = Gauge(
    "copilot_benchmark_total_cases",
    "Total number of cases in the last benchmark run",
)

benchmark_total_failed = Gauge(
    "copilot_benchmark_total_failed",
    "Total number of failed cases in the last benchmark run",
)


def record_benchmark_run(results: dict):
    """Call this after every benchmark run (POST /api/copilot/benchmark)."""
    import time as _time

    benchmark_overall_pass_rate.set(results.get("overall_pass_rate", 0))
    benchmark_total_cases.set(results.get("total_cases", 0))
    benchmark_total_failed.set(results.get("total_failed", 0))
    benchmark_last_run_timestamp.set(_time.time())
    for g in results.get("groups", []):
        benchmark_group_pass_rate.labels(
            group_id=g["id"], group_name=g["name"]
        ).set(g.get("pass_rate", 0))


def metrics_response():
    """Returns (body_bytes, content_type) for the /metrics endpoint."""
    return generate_latest(), CONTENT_TYPE_LATEST
