> [!WARNING] Archived — Original Design Spec
> This note is from the project's original planning phase (`.agents/` in the repo root, migrated 2026-07-19). It describes **intended** architecture and may not match what was actually implemented — e.g. this document set originally specified FAISS + Neo4j for the data layer, but the live system uses Qdrant, and the Neo4j graph-sync path was removed as dead code. Treat this as historical design rationale, not current-state documentation. For what's actually running, see the `Devices/`, `Protocols/`, `Monitoring/` etc. folders (live, auto-generated) or `CLAUDE.md` in the repo root.

---

# NETAct AI Agent — Architecture Overview

## 1. Purpose

This document defines the architecture for embedding a **Qwen-based AI agent** into NETAct (your network automation and management system), capable of interacting with live network elements and CI/CD infrastructure through a controlled tool layer.

The agent must be able to:
- Answer operational questions about the network using both unstructured knowledge (docs, runbooks) and structured topology (graph relationships).
- Execute read operations against routers/switches (e.g. `show` commands) via SSH.
- Query CI/CD pipeline state (e.g. IPTV/VAS migration jobs, automation script runs) via HTTP.
- Optionally propose or execute write/config operations, gated behind human approval.

## 2. Layered Architecture

```
                    USER
                     |
                     v
              ┌──────────────┐
              │  LangGraph   │   ← Agent orchestration (brain)
              └──────┬───────┘
                     |
                     v
          ┌──────────────────────┐
          │       LCEL            │   ← Pipelines (RAG / Chains)
          └──────┬─────────────────┘
                 |
     ┌───────────┼─────────────────────┐
     |           |                     |
     v           v                     v
   FAISS      Neo4j                 MCP Client
  (Vector)   (Graph)               (Tools Layer)
     |           |                     |
     └───────────┴──────────────┬──────┘
                                v
                          MCP Server
                  (asyncssh tools + CI/CD HTTP tools)
                                |
                                v
                    Network Devices / CI/CD API
```

| Layer | Role | Technology |
|---|---|---|
| Orchestration | Decides *what to do*: routing, tool selection, approval gating, conversation state | LangGraph |
| Pipelines | Decides *how to retrieve/compose context*: RAG over docs, graph queries, prompt assembly | LCEL |
| Knowledge (unstructured) | Similarity search over docs, configs, runbooks, past incidents | FAISS |
| Knowledge (structured) | Topology, dependencies, device relationships | Neo4j |
| Tooling | Executes real actions against real systems | MCP Server (asyncssh, HTTP) |
| Model | Reasoning, tool-calling, response generation | Qwen (served locally) |

## 3. Why this split

- **LangGraph owns control flow**, not data access. It decides which node runs next (retrieve context → pick tool → execute → validate → respond), and it's the only layer that knows about conversation state, retries, and human-in-the-loop interrupts.
- **LCEL owns data composition**. Chains here are stateless, declarative, and reusable — "given a question, retrieve docs + graph facts, build a prompt, call the model." LCEL chains are invoked *as nodes inside* the LangGraph graph, not as a competing orchestrator.
- **MCP Server is the only component allowed to touch real infrastructure.** Neither LangGraph nor LCEL talk to devices directly — everything physical goes through MCP tools, which gives you a single place to enforce auth, logging, rate limiting, and command allowlisting.
- **FAISS and Neo4j are read paths for context, not action paths.** They never receive write traffic from the agent; they're populated by separate ingestion/sync jobs (see `04-data-layer-faiss-neo4j.md`).

## 4. Request Lifecycle (example)

User asks: *"Why is BGP down on edge router CDN-EDGE-03, and is there an active migration job touching it?"*

1. **LangGraph — Intent Router**: classifies this as a diagnostic query touching both live device state and CI/CD state.
2. **LCEL — Hybrid Retrieval Chain**: pulls topology context for `CDN-EDGE-03` from Neo4j (neighbors, role, site) and relevant runbook snippets from FAISS (BGP troubleshooting steps for this platform).
3. **LangGraph — Tool Selector**: decides two MCP tools are needed: `ssh_execute_command` (read-only `show bgp summary`) and `cicd_pipeline_status` (filtered by device/site tag).
4. **MCP Client → MCP Server**: executes both tools concurrently against the asyncssh tool and the CI/CD HTTP tool.
5. **LangGraph — Validator**: since both tools are read-only, no approval gate is triggered.
6. **LCEL — Synthesis Chain**: combines retrieved context + live tool output into a grounded answer.
7. **Response** returned to user, with the raw command output and pipeline status attached as evidence.

A write-action example (e.g. "shut that BGP neighbor") would route through the same graph but stop at a **Human Approval node** before the `ssh_execute_config` tool is allowed to run — see `05-security-and-deployment.md`.

## 5. Design Principles

1. **Read by default, write by exception.** Any tool capable of changing device/network state is a distinct tool from its read-only counterpart, with its own risk tier and approval requirement.
2. **Every tool call is auditable.** MCP Server logs tool name, input, target device/endpoint, requester, and result — independent of whatever LangGraph logs about reasoning.
3. **The model never gets raw credentials.** Qwen only ever sees tool *names and schemas*; the MCP Server resolves credentials from a vault at execution time.
4. **Context before action.** The graph always attempts RAG/graph retrieval before tool execution, so the agent grounds its tool choice in actual topology/docs rather than guessing from the prompt alone.
5. **Stateless tools, stateful graph.** MCP tools are pure request/response; all conversational memory, retries, and approval state live in LangGraph's checkpointed state — this keeps the MCP Server simple and horizontally scalable.

## 6. Companion Documents

| File | Covers |
|---|---|
| `01-langgraph-agent-design.md` | State schema, nodes, conditional routing, human-in-the-loop |
| `02-lcel-rag-pipelines.md` | RAG/graph retrieval chains, prompt assembly, output parsing |
| `03-mcp-server-tools-spec.md` | Tool catalog, asyncssh tool design, CI/CD HTTP tool design |
| `04-data-layer-faiss-neo4j.md` | What's indexed, schema, sync/ingestion strategy |
| `05-security-and-deployment.md` | RBAC, approval workflow, credential handling, rollout phases |
