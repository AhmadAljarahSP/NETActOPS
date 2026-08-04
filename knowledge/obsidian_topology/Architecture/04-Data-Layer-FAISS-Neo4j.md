> [!WARNING] Archived — Original Design Spec
> This note is from the project's original planning phase (`.agents/` in the repo root, migrated 2026-07-19). It describes **intended** architecture and may not match what was actually implemented — e.g. this document set originally specified FAISS + Neo4j for the data layer, but the live system uses Qdrant, and the Neo4j graph-sync path was removed as dead code. Treat this as historical design rationale, not current-state documentation. For what's actually running, see the `Devices/`, `Protocols/`, `Monitoring/` etc. folders (live, auto-generated) or `CLAUDE.md` in the repo root.

---

# Data Layer — FAISS (Vector) & Neo4j (Graph)

## 1. Role in the System

Both stores are **read paths for context**, populated by ingestion/sync jobs that run independently of the agent. The agent never writes to either store as part of answering a question — keeping write access out of the agent's reach avoids the failure mode where a bad retrieval poisons future retrievals.

## 2. FAISS — Unstructured Knowledge

### What's indexed
| Source | Refresh cadence | Notes |
|---|---|---|
| Vendor command references (IOS-XR) | Rarely (on vendor doc update) | Chunked per command/section |
| Internal runbooks / SOPs | On edit (event-driven) | Highest-trust source — weight accordingly in retrieval |
| Past incident reports | On incident closure | Helps recognize recurring patterns |
| Migration project documentation | On project milestone | e.g. IPTV/VAS v2→v6 notes |
| Automation script docs/READMEs | On commit | So the agent can explain what your own tooling does |

### Embedding & index considerations
- Re-embedding the full corpus is cheap relative to query volume, so favor an embedding model choice that prioritizes retrieval quality over indexing speed.
- Keep a metadata field per chunk (`source_type`, `last_updated`, `platform`) so retrieval can be filtered (e.g. "only IOS-XR docs") before similarity ranking, not just ranked globally.
- Periodic re-index rather than incremental-only, to catch stale/superseded runbook content — flag chunks older than a threshold (e.g. 12 months) as lower-confidence in retrieval results.

## 3. Neo4j — Structured Topology

### Core node types
| Node label | Key properties |
|---|---|
| `Device` | hostname, platform, role (edge/core/CDN), site, mgmt_ip |
| `Interface` | name, device, status, speed |
| `BGPNeighbor` | peer_ip, ASN, peer_group |
| `Site` | name, region |
| `VLAN` | id, description |
| `CDNNode` | capacity, current_utilization, region |
| `Pipeline` | (mirrored reference from CI/CD, for "what migration touches this device" queries) |

### Core relationship types
| Relationship | Example |
|---|---|
| `CONNECTED_TO` | `(Interface)-[:CONNECTED_TO]->(Interface)` physical/logical link |
| `PEERS_WITH` | `(Device)-[:PEERS_WITH]->(BGPNeighbor)` |
| `HOSTS` | `(Device)-[:HOSTS]->(Interface)` |
| `LOCATED_AT` | `(Device)-[:LOCATED_AT]->(Site)` |
| `MEMBER_OF` | `(Interface)-[:MEMBER_OF]->(VLAN)` |
| `TARGETS` | `(Pipeline)-[:TARGETS]->(Device)` — links CI/CD jobs to affected devices |

This schema is what makes "what's the blast radius if this link goes down" or "which devices does this migration job touch" answerable as a graph traversal instead of a guess.

### Sync strategy
- **Discovery jobs** (separate from the live agent path) periodically connect to devices — via the same asyncssh tooling, but run as scheduled batch jobs, not agent-triggered — to refresh topology, BGP neighbor state, and interface status into Neo4j.
- **CI/CD linkage**: a lightweight sync job polls the CI/CD API to populate `Pipeline` nodes and their `TARGETS` relationships, so the agent's graph queries can answer "is an active job touching this device" without a live API call on every question.
- **Freshness metadata**: every synced node carries a `last_synced` timestamp; the Hybrid Retrieval Chain surfaces this to the model/UI so stale topology data isn't presented as current state with false confidence (live `ssh_show_command` tool calls remain the source of truth for "right now" questions).

### Query safety
- Default access role for the agent's graph chain is **read-only** at the Neo4j level (separate from the MCP Server's own RBAC), so even a malformed Text2Cypher query can't mutate the graph.
- Templated queries are parameterized (device IDs as parameters, not string-interpolated) to avoid Cypher injection from user input.

## 4. How the Two Stores Complement Each Other

| Question type | Best source |
|---|---|
| "What does this error code mean?" | FAISS (docs) |
| "What's upstream of CDN-EDGE-03?" | Neo4j (graph) |
| "Why is BGP down and is a migration touching it?" | Both — graph for topology + job linkage, FAISS for troubleshooting steps |
| "What's the current BGP state right now?" | Neither — live `ssh_show_command` tool call, since both stores reflect last-sync state, not real-time |

This last row matters: FAISS and Neo4j ground the agent's *reasoning*, but anything the user wants verified "right now" should always trigger a live MCP tool call rather than being answered from cached graph/vector state alone.
