> [!WARNING] Archived — Original Design Spec
> This note is from the project's original planning phase (`.agents/` in the repo root, migrated 2026-07-19). It describes **intended** architecture and may not match what was actually implemented — e.g. this document set originally specified FAISS + Neo4j for the data layer, but the live system uses Qdrant, and the Neo4j graph-sync path was removed as dead code. Treat this as historical design rationale, not current-state documentation. For what's actually running, see the `Devices/`, `Protocols/`, `Monitoring/` etc. folders (live, auto-generated) or `CLAUDE.md` in the repo root.

---

# LangGraph Agent Design

## 1. Role in the System

LangGraph is the orchestration layer — it owns the **state machine** that represents one agent turn (or multi-turn session), and decides which node executes next. It does not itself perform retrieval or call tools; it delegates those to LCEL chains and the MCP client, then reasons over the results.

## 2. State Schema

The graph state is the single object passed between nodes. Conceptually (not as code):

| Field | Type | Description |
|---|---|---|
| `messages` | list | Full conversation history (user, assistant, tool messages) |
| `intent` | enum | `diagnostic`, `informational`, `config_change`, `pipeline_query`, `mixed` |
| `retrieved_context` | object | Output of the LCEL retrieval chain: doc snippets + graph facts |
| `target_devices` | list | Device hostnames/IDs resolved from the query or graph lookup |
| `planned_tools` | list | Tool calls the model has proposed, with arguments |
| `risk_tier` | enum | `read_only`, `write_low_risk`, `write_high_risk` |
| `approval_status` | enum | `not_required`, `pending`, `approved`, `rejected` |
| `tool_results` | list | Raw outputs from MCP tool execution |
| `final_response` | string | Synthesized answer returned to the user |
| `session_meta` | object | User identity, role, request timestamp, trace ID |

This state is checkpointed between turns so the agent retains context across a multi-step conversation (e.g. "check it" referring to the device mentioned two messages ago).

## 3. Graph Nodes

```
            ┌────────────────┐
   START -->│ Intent Router   │
            └───────┬─────────┘
                    v
            ┌────────────────┐
            │ Context         │   (LCEL hybrid retrieval: FAISS + Neo4j)
            │ Retriever       │
            └───────┬─────────┘
                    v
            ┌────────────────┐
            │ Tool Planner    │   (Qwen proposes tool calls + args)
            └───────┬─────────┘
                    v
            ┌────────────────┐
            │ Risk Classifier │── read_only ──────────┐
            └───────┬─────────┘                       |
                write/high-risk                        v
                    v                          ┌────────────────┐
            ┌────────────────┐                 │ Tool Executor   │
            │ Human Approval  │── approved ───> │ (MCP Client)    │
            │ Gate (interrupt)│                 └───────┬─────────┘
            └───────┬─────────┘                         v
                rejected                        ┌────────────────┐
                    v                            │ Response        │
            ┌────────────────┐                  │ Synthesizer     │
            │ Decline /        │ <───────────────┴────────────────┘
            │ Explain Node     │
            └───────┬─────────┘
                    v
                   END
```

### Node descriptions

**Intent Router**
Classifies the incoming message into one of the intent categories above using a lightweight Qwen prompt (no tool access). Determines whether the query needs live device data, CI/CD data, both, or neither (pure knowledge lookup).

**Context Retriever**
Invokes the LCEL hybrid retrieval chain (see `02-lcel-rag-pipelines.md`). Pulls relevant documentation/runbook snippets from FAISS and topology facts from Neo4j. This step always runs before tool planning so the model has grounding before it decides what to execute.

**Tool Planner**
Qwen, given the retrieved context and the MCP tool catalog (tool names + schemas, not implementations), proposes zero or more tool calls. If no tools are needed (pure informational question), the graph routes directly to the Response Synthesizer.

**Risk Classifier**
Deterministic, non-LLM logic that inspects `planned_tools` and assigns `risk_tier` based on the tool's declared risk level in the MCP catalog (not the model's judgment — this must not be left to the LLM alone). Any tool tagged `write` in the catalog forces at least `write_low_risk`.

**Human Approval Gate**
A LangGraph `interrupt` node. For anything above `read_only`, the graph pauses and surfaces the planned tool call(s), target device(s), and the model's stated rationale to a human operator (via NETAct's UI). Execution only resumes on explicit `approved`. This is a hard gate, not a suggestion the model can route around.

**Tool Executor**
Invokes the MCP client, which dispatches to the MCP Server. Supports parallel tool calls (e.g. SSH read + CI/CD status check simultaneously) where tools are independent.

**Response Synthesizer**
LCEL chain that combines `retrieved_context` + `tool_results` into a final natural-language answer, with raw evidence (command output, pipeline status JSON) attached for transparency.

**Decline/Explain Node**
If approval is rejected, generates a clear explanation to the user of what was proposed and why it wasn't executed, without retrying automatically.

## 4. Conditional Routing Logic

Routing decisions are deterministic functions over state, not free-form model output:

- `intent == informational` and no device/job entities resolved → skip Tool Planner, go straight from Context Retriever to Response Synthesizer.
- `risk_tier == read_only` → skip Human Approval Gate entirely.
- `approval_status == rejected` → route to Decline/Explain, never silently retry with a different tool.
- Tool Executor failure (timeout, device unreachable) → route to a **Retry/Fallback** branch (max 1 retry) before falling through to Response Synthesizer with a partial-failure note, rather than looping indefinitely.

## 5. Human-in-the-Loop Mechanics

LangGraph's checkpointing/interrupt support is used so that:
- The graph execution genuinely pauses at the Approval Gate (not just a fast UI prompt) — state is persisted, so approval can come minutes or hours later without losing context.
- The operator sees exactly the tool name, arguments, and target device(s) that will run — not a paraphrase.
- Approval is tied to the specific proposed action; if the operator edits the command/target, that counts as a new proposal and is re-classified by the Risk Classifier rather than auto-approved.

## 6. Memory Strategy

- **Short-term (per-session)**: full `messages` history kept in graph state for the duration of a conversation thread.
- **Long-term (cross-session)**: summarized facts (e.g. "user frequently asks about CDN-EDGE site") can be persisted separately and re-injected into `retrieved_context`, but this is explicitly opt-in and never includes credentials or raw command output.

## 7. Why not let LCEL drive control flow?

LCEL chains are linear/DAG pipelines — great for "always do A then B then C," but they don't natively support conditional branching on risk tier, pausing for human approval, or resuming after an external event. LangGraph is used specifically because the agent's control flow is *not* linear: it branches on risk, can pause indefinitely, and needs durable state across that pause.
