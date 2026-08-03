> [!WARNING] Archived — Original Design Spec
> This note is from the project's original planning phase (`.agents/` in the repo root, migrated 2026-07-19). It describes **intended** architecture and may not match what was actually implemented — e.g. this document set originally specified FAISS + Neo4j for the data layer, but the live system uses Qdrant, and the Neo4j graph-sync path was removed as dead code. Treat this as historical design rationale, not current-state documentation. For what's actually running, see the `Devices/`, `Protocols/`, `Monitoring/` etc. folders (live, auto-generated) or `CLAUDE.md` in the repo root.

---

# LCEL Pipelines — RAG & Retrieval Chains

## 1. Role in the System

LCEL (LangChain Expression Language) chains are the **data composition layer**. Each chain is a declarative pipeline: input → retrieve → format → (optionally) call model → structured output. Chains are invoked as single nodes from inside the LangGraph graph — they don't make control-flow decisions themselves.

Three chains matter for this system:

1. **Vector RAG Chain** (FAISS) — unstructured knowledge.
2. **Graph Retrieval Chain** (Neo4j) — structured topology/relationship facts.
3. **Hybrid Retrieval Chain** — merges the two and feeds the Tool Planner / Response Synthesizer.

## 2. Vector RAG Chain (FAISS)

**Purpose**: surface relevant unstructured knowledge — vendor documentation, internal runbooks, past incident write-ups, IOS-XR command references, migration notes.

**Pipeline shape**:
```
question
   → embed (query embedding model)
   → FAISS similarity search (top-k)
   → re-rank / dedupe
   → format as context block
```

**Embedding model**: given the corpus is mostly technical/network documentation, a strong general-purpose embedding model matters more than a multilingual one. Worth evaluating `BGE-M3` or `Qwen3-Embedding` for consistency with the Qwen model family already in use, against `mxbai-embed-large` as a baseline — same trade-offs you've already been weighing for other RAG work apply directly here (retrieval quality vs. index size vs. inference cost on local hardware).

**What gets indexed**:
| Source | Notes |
|---|---|
| Vendor docs (Cisco IOS-XR command reference) | Chunked by command/section, not whole-PDF |
| Internal runbooks | Troubleshooting procedures, escalation paths |
| Past incident reports | Helps the model recognize recurring failure patterns |
| Migration project notes (e.g. IPTV/VAS v2→v6) | So the agent can answer "is this related to the migration?" |

**Chunking guidance**: chunk by logical section (a single `show` command's meaning, a single troubleshooting step) rather than fixed token windows — network docs lose meaning badly when split mid-procedure.

## 3. Graph Retrieval Chain (Neo4j)

**Purpose**: answer questions that are fundamentally about *relationships* — "what's upstream of this CDN node," "which devices share this BGP peer group," "what's the blast radius if this link goes down" — which vector search handles poorly.

**Pipeline shape**:
```
question
   → entity extraction (identify device/site/interface names mentioned)
   → resolve entities to graph node IDs
   → templated Cypher query (parameterized, not LLM-generated for routine lookups)
   → format graph result as context block
```

**Two retrieval modes**:
- **Templated queries** for common patterns (neighbors-of, path-between, devices-in-site). Fast, deterministic, no risk of malformed/expensive Cypher.
- **LLM-generated Cypher** (Text2Cypher) only as a fallback for genuinely novel questions, run against a read-only Neo4j role, with a query cost/row-limit guard. This path should be the exception, not the default, given the reliability concerns of LLM-generated queries against production graph data.

See `04-data-layer-faiss-neo4j.md` for the graph schema this chain queries against.

## 4. Hybrid Retrieval Chain

**Purpose**: most real operator questions need both — "why is BGP down on X" needs the topology (who are X's neighbors) *and* the documentation (what does this error code mean).

**Pipeline shape**:
```
question
   ├─→ Vector RAG Chain   ──┐
   └─→ Graph Retrieval Chain ┤→ merge → dedupe/prioritize → context block
```

Merge strategy: graph facts (structured, ground-truth) are treated as higher-confidence than vector hits (similarity-based, can be tangential) and are placed first in the assembled context, with vector snippets appended as supporting detail.

## 5. Prompt Assembly

The Response Synthesizer's prompt template combines, in order:
1. System instructions (role, constraints, tone, explicit instruction to cite which facts came from live tool output vs. retrieved docs).
2. Graph facts block.
3. Vector doc snippets block.
4. Tool execution results (if any).
5. Conversation history (trimmed to a relevant window).
6. The user's question.

Keeping these as separate labeled blocks (rather than one merged paragraph) makes it possible for the model to attribute claims correctly and for you to debug *why* it said something.

## 6. Structured Output

For anything that downstream NETAct UI components will render (e.g. a tool-call proposal, a structured diagnostic summary), the chain should request structured output (a defined schema: fields like `summary`, `evidence`, `confidence`, `recommended_action`) rather than free text — this is what lets LangGraph's Risk Classifier and the approval UI work deterministically instead of parsing prose.

## 7. Why LCEL specifically (vs. building this inside LangGraph nodes directly)

- **Reusability**: the same Hybrid Retrieval Chain is used both before tool planning (to ground tool selection) and before response synthesis (to ground the final answer) — defining it once as an LCEL chain avoids duplicating retrieval logic in two LangGraph nodes.
- **Composability**: chains are easy to swap or A/B test (e.g. try a different embedding model, or add a re-ranking step) without touching the orchestration graph.
- **Streaming**: LCEL chains support streaming output natively, useful if NETAct's UI wants token-level streaming for the final synthesized response.
