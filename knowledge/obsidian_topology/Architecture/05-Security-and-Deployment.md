> [!WARNING] Archived — Original Design Spec
> This note is from the project's original planning phase (`.agents/` in the repo root, migrated 2026-07-19). It describes **intended** architecture and may not match what was actually implemented — e.g. this document set originally specified FAISS + Neo4j for the data layer, but the live system uses Qdrant, and the Neo4j graph-sync path was removed as dead code. Treat this as historical design rationale, not current-state documentation. For what's actually running, see the `Devices/`, `Protocols/`, `Monitoring/` etc. folders (live, auto-generated) or `CLAUDE.md` in the repo root.

---

# Security & Deployment

## 1. Threat Model Summary

The main risks this design needs to guard against:
- An agent (or a user prompting it) issuing an unintended **write/config command** against production network devices.
- **Credential exposure** through model context, logs, or chat history.
- **Over-broad tool access** — a single compromised/misused session able to touch devices outside its intended scope.
- **Stale data presented as live state** — graph/vector retrieval being mistaken for real-time truth.
- **Unbounded blast radius** from a single bad tool call (e.g. a command run against an entire device group instead of one device).

## 2. Access Control

| Layer | Control |
|---|---|
| MCP Server | Per-tool RBAC — which user roles can even *propose* `ssh_config_command` / `cicd_trigger_job` calls |
| Device layer | asyncssh sessions use a service identity with the minimum privilege needed for allowlisted commands — not a full-admin account |
| Neo4j | Read-only role for the agent's graph chain; write access reserved for the separate sync/discovery jobs |
| CI/CD API | Scoped service token — read scope for status/logs tools, separate elevated scope only for the trigger tool |

Tie tool-level RBAC to NETAct's existing user/role system rather than building a parallel auth model — the agent should never have more access than the human operator driving it would have directly.

## 3. Credential Handling

- Credentials live in a vault/secrets manager, resolved by the MCP Server at execution time, keyed by `device_id` or service name.
- **Never** pass credentials through LangGraph state, LCEL prompts, or model input/output — the model only ever sees tool *names and schemas*.
- Vault access is logged separately from agent activity, so credential retrieval is auditable independent of what the agent did with it.
- Rotate the service account(s) used for SSH/API access on your normal credential rotation cadence — the agent's access should follow your existing policy, not introduce a new exception.

## 4. Human-in-the-Loop Approval Workflow

Already defined structurally in `01-langgraph-agent-design.md`; operational notes:
- Approval requests show: target device(s)/pipeline, exact command/parameters, the agent's stated rationale, and the retrieved context that led to the proposal.
- Approval is **scoped to the exact proposed action** — an operator editing the command before approving counts as a new proposal, re-evaluated by the Risk Classifier (this prevents "approve, then silently substitute a different command" failure modes).
- Approval timeout: if not approved/rejected within a defined window, the action expires rather than executing automatically later when context may have changed.
- All approvals/rejections are logged with operator identity and timestamp, alongside the MCP Server's own tool audit log.

## 5. Audit & Observability

Two independent logs, intentionally not merged into one:
1. **LangGraph trace log** — reasoning steps, retrieved context, tool proposals, approval decisions. Useful for understanding *why* the agent did something.
2. **MCP Server tool log** — actual tool invocations, arguments, targets, results. This is the authoritative record of *what touched the network*, and should be the one you'd hand to a change-management/compliance review.

Both should share a `trace_id` so any tool execution can be traced back to the conversation that triggered it.

## 6. Deployment Topology

| Component | Suggested placement |
|---|---|
| Qwen model serving | Local inference (e.g. vLLM/Ollama-style serving), on infrastructure with network reach only to the MCP Server and LCEL/LangGraph app — no direct device access |
| LangGraph + LCEL app | Application tier, talks to FAISS, Neo4j, and the MCP client |
| MCP Server | Sits closer to the management network boundary — the one component with asyncssh reach to devices and HTTP reach to the CI/CD API |
| FAISS index | Local to the app tier or a dedicated retrieval service; rebuilt from source docs on the refresh cadence in `04-data-layer-faiss-neo4j.md` |
| Neo4j | Dedicated graph DB instance, populated by scheduled discovery/sync jobs, not the live agent path |

Network segmentation principle: the model-serving tier should **not** be able to reach devices or the CI/CD API directly — only the MCP Server has that reach, and only via its allowlisted tool implementations.

## 7. Phased Rollout

| Phase | Scope | Approval requirement |
|---|---|---|
| **Phase 1** | Read-only Q&A: docs, topology, CI/CD status. No SSH execution. | N/A — nothing executes |
| **Phase 2** | Add `ssh_show_command` (read-only device commands) for guided diagnostics | N/A — read-only |
| **Phase 3** | Add `ssh_config_command` / `cicd_trigger_job` in **supervised mode** | Mandatory human approval, every time, no exceptions |
| **Phase 4** (future, optional) | Narrow, pre-approved low-risk config changes auto-executed (e.g. a single well-tested remediation pattern) | Approval still required initially; auto-execution only considered after a sustained track record in Phase 3 |

Recommendation: don't shorten Phase 3 — the value of the system as a diagnostic/troubleshooting copilot is high even if write capability stays supervised indefinitely; the risk/benefit of full autonomy on production network config is a separate decision from getting the assistant useful day-to-day.

## 8. Open Decisions to Resolve Before Build

- Which NETAct user roles get access to which risk tiers of tool.
- Approval timeout duration and escalation path if no operator responds.
- Whether `ssh_config_command` supports a rollback/commit-confirm mechanism on your platforms, and whether that's mandatory before Phase 3 goes live.
- Retention period for the MCP Server tool audit log vs. the LangGraph trace log.
