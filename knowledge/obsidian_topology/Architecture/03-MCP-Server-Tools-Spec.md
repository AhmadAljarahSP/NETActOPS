> [!WARNING] Archived — Original Design Spec
> This note is from the project's original planning phase (`.agents/` in the repo root, migrated 2026-07-19). It describes **intended** architecture and may not match what was actually implemented — e.g. this document set originally specified FAISS + Neo4j for the data layer, but the live system uses Qdrant, and the Neo4j graph-sync path was removed as dead code. Treat this as historical design rationale, not current-state documentation. For what's actually running, see the `Devices/`, `Protocols/`, `Monitoring/` etc. folders (live, auto-generated) or `CLAUDE.md` in the repo root.

---

# MCP Server — Tool Specification

## 1. Role in the System

The MCP Server is the **only** component with network reach to real devices and the CI/CD system. It exposes a small, explicit catalog of tools over MCP; the LangGraph agent (via an MCP client) can only ever call what's in this catalog — there is no general-purpose "run arbitrary command" tool exposed to the model.

## 2. Tool Catalog

| Tool name | Transport | Risk tier | Approval required | Description |
|---|---|---|---|---|
| `ssh_show_command` | asyncssh | `read_only` | No | Runs an allowlisted `show`/operational command on a target device |
| `ssh_config_command` | asyncssh | `write_high_risk` | Yes | Applies a configuration change to a target device |
| `cicd_pipeline_status` | HTTP GET | `read_only` | No | Fetches status of a CI/CD pipeline/job by ID or filter |
| `cicd_job_logs` | HTTP GET | `read_only` | No | Fetches logs for a specific CI/CD job run |
| `cicd_trigger_job` | HTTP POST | `write_low_risk` | Yes | Triggers a CI/CD pipeline (e.g. re-run a migration validation job) |
| `device_inventory_lookup` | internal | `read_only` | No | Resolves a hostname/alias to connection details (no credentials returned to model) |

Each tool is defined with an explicit input/output schema so the model's tool calls are validated before anything reaches the network.

### `ssh_show_command`
- **Input**: `device_id` (resolved hostname), `command` (must match an allowlist pattern, e.g. `^show (bgp|interface|cdp|ip route).*`)
- **Output**: raw command text output, execution timestamp, device prompt/hostname confirmation (to catch wrong-device execution)
- **Constraints**: command allowlist enforced server-side (regex or exact-match list), not client-side — the model proposing a disallowed command should get a structured rejection, not a silent failure.
- **Timeout**: short, fixed timeout (e.g. 10–15s) per command; no interactive/paging prompts — disable pagination (`terminal length 0` equivalent) as part of session setup, not left to the model to remember.

### `ssh_config_command`
- **Input**: `device_id`, `config_lines` (list, not freeform text), `change_ticket_id` (optional but recommended), `dry_run` (bool)
- **Output**: diff of intended change (when `dry_run=true`), or applied result + rollback reference
- **Constraints**: always routed through the Human Approval Gate (see `01-langgraph-agent-design.md`). Server should support a config rollback mechanism (e.g. checkpoint/commit-confirm pattern on platforms that support it) independent of the agent.

### `cicd_pipeline_status`
- **Input**: `pipeline_id` *or* `filter` (e.g. site/device tag, date range)
- **Output**: status enum (`running`, `success`, `failed`, `pending`), timestamps, related artifact links
- **Auth**: server-side service token to the CI/CD API; never passed through to the model.

### `cicd_job_logs`
- **Input**: `job_id`, optional `tail_lines`
- **Output**: log text (truncated/paginated server-side to avoid flooding model context)

### `cicd_trigger_job`
- **Input**: `pipeline_id`, `parameters`
- **Output**: new job ID + initial status
- **Constraints**: write tier — same approval gate as config changes.

### `device_inventory_lookup`
- **Input**: `query` (hostname, alias, site, role)
- **Output**: canonical `device_id`, platform type, site, management IP (credentials resolved server-side only, never returned)

## 3. asyncssh Tool Design Notes

- **Connection pooling**: maintain a small pool of reusable asyncssh connections per device or per device group, rather than opening a fresh SSH session per tool call — reduces latency and avoids hammering device SSH daemons during multi-step diagnostics.
- **Concurrency limits**: cap concurrent sessions per device (usually 1, to avoid CLI session conflicts on platforms with limited VTY lines) and globally (to avoid overwhelming the OOB management network).
- **Credential resolution**: the tool layer resolves credentials from a vault/secrets manager keyed by `device_id` at call time — credentials never appear in LangGraph state, LCEL context, or model input/output.
- **Output sanitization**: strip ANSI/control characters and pagination artifacts from raw device output before returning it, since IOS-XR `show` output can otherwise pollute the model's context with formatting noise.
- **Session teardown**: explicit idle timeout per pooled connection so stale sessions don't accumulate on devices over a long-running NETAct process.

## 4. CI/CD HTTP Tool Design Notes

- **Auth**: server-side bearer token / service account, refreshed independently of any single tool call.
- **Idempotency**: GET-based tools (`cicd_pipeline_status`, `cicd_job_logs`) are safe to retry; mark them as such so LangGraph's retry/fallback branch can safely re-attempt on transient failure without that being a "new action."
- **Rate limiting**: respect the CI/CD platform's API rate limits server-side; queue rather than fail hard on burst queries (e.g. when a diagnostic touches many pipelines).
- **Response shaping**: truncate/summarize large log payloads before they reach the model — full raw logs available as a downloadable artifact in the NETAct UI instead of being stuffed into context.

## 5. Tool Result Envelope

Every tool, regardless of transport, returns a consistent envelope so the LangGraph Tool Executor and Response Synthesizer can handle results uniformly:

| Field | Description |
|---|---|
| `tool_name` | Which tool ran |
| `status` | `success`, `error`, `timeout`, `rejected` (allowlist violation) |
| `target` | Device ID or pipeline ID |
| `result` | Tool-specific payload |
| `duration_ms` | Execution time |
| `trace_id` | Correlates back to the LangGraph session for audit |

## 6. Audit Logging

The MCP Server logs every tool invocation independently of LangGraph's own logging — tool name, full input arguments, requesting user/session, target, result status, and timestamp. This log is the source of truth for "what actually touched the network," separate from "what the agent reasoned about," and should be retained according to your existing change-management/audit retention policy.
