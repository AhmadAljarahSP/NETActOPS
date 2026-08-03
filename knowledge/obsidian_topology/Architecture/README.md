> [!WARNING] Archived — Original Design Spec
> This whole folder is from the project's original planning phase (`.agents/` in the repo root, migrated 2026-07-19). It describes **intended** architecture and may not match what was actually implemented — e.g. this document set originally specified FAISS + Neo4j for the data layer, but the live system uses Qdrant, and the Neo4j graph-sync path was removed as dead code. Treat this as historical design rationale, not current-state documentation. For what's actually running, see the `Devices/`, `Protocols/`, `Monitoring/` etc. folders (live, auto-generated) or `CLAUDE.md` in the repo root.

---

# Architecture — Original Design Spec (Archived)

Migrated from `.agents/` in the repo root. Nine documents from the project's original planning phase.

## Contents
- [[Agent-Rules-and-Guidelines]] — safety gating, NOC troubleshooting protocol, report formatting rules. Largely still accurate — matches what's implemented in `agent.py`'s risk_classifier_node and local_synthesizer_node.
- [[00-Architecture-Overview]]
- [[01-LangGraph-Agent-Design]]
- [[02-LCEL-RAG-Pipelines]]
- [[03-MCP-Server-Tools-Spec]]
- [[04-Data-Layer-FAISS-Neo4j]] — **known stale**: specifies FAISS + Neo4j; actual system uses Qdrant, no graph DB.
- [[05-Security-and-Deployment]]
- [[06-Implementation-Plan-Assistant-Upgrade]]
- [[07-Intent-Routing-and-Sanitization]]

Not included in Qdrant/RAG indexing (see `_VAULT_INDEX_FOLDERS` in `ai/backend/vector_sync.py`) — deliberately, so stale sections here can't surface as if they were current fact in copilot chat answers. Browse in Obsidian only.
