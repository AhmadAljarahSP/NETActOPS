import os
import re
import logging
import httpx
from typing import Optional

logger = logging.getLogger("pipelines")

# Configurations
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://NETAct_ollama:11434")
QDRANT_URL = os.getenv("QDRANT_HOST", "http://NETAct_qdrant:6333")

# ---------------------------------------------------------------------------
# 1. Vector RAG Pipeline (Qdrant – real embedding similarity search)
# ---------------------------------------------------------------------------
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")

async def _get_query_embedding(query: str) -> list[float] | None:
    """Gets a query embedding vector from Ollama nomic-embed-text."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/embeddings",
                json={"model": EMBEDDING_MODEL, "prompt": query}
            )
            resp.raise_for_status()
            return resp.json().get("embedding")
    except Exception as e:
        logger.error(f"Failed to get embedding from Ollama: {e}")
        return None

async def query_qdrant_vector_db(query: str, limit: int = 5, disabled_docs: list[str] = []) -> list[dict]:
    """Queries Qdrant using real semantic embedding similarity (nomic-embed-text via Ollama).
    Falls back to keyword scroll if embedding is unavailable."""

    # --- Primary path: real vector similarity search ---
    query_vector = await _get_query_embedding(query)

    if query_vector:
        search_body: dict = {
            "vector": query_vector,
            "limit": limit,
            "with_payload": True,
            "score_threshold": 0.45,   # Balanced: low enough for KB docs, high enough to block off-topic telemetry
        }
        if disabled_docs:
            search_body["filter"] = {
                "must_not": [
                    {"key": "filename", "match": {"value": doc}}
                    for doc in disabled_docs
                ]
            }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    f"{QDRANT_URL}/collections/netact_knowledgebase/points/search",
                    json=search_body
                )
                resp.raise_for_status()
                results = resp.json().get("result", [])

            return [
                {
                    "filename": r["payload"].get("filename", "unknown"),
                    "page": r["payload"].get("page", 1),
                    "text": r["payload"].get("text", ""),
                    "score": round(r.get("score", 0), 4),
                    "chunk_index": r["payload"].get("chunk_index"),
                }
                for r in results
            ]
        except Exception as e:
            logger.error(f"Qdrant vector search failed: {e}. Falling back to keyword scroll.")

    # --- Fallback path: keyword scroll (used only when embedding unavailable) ---
    logger.warning("Using keyword-scroll fallback for Qdrant (embedding unavailable).")
    stopwords = {
        "what", "is", "the", "of", "for", "in", "on", "a", "an", "and", "or", "to", "from",
        "at", "by", "with", "about", "ip", "address", "find", "show", "get", "tell", "list",
        "search", "document", "documentation", "file", "pdf", "txt", "database", "vector"
    }
    words = re.findall(r"\b[a-zA-Z0-9_-]+\b", query.lower())
    keywords = [w for w in words if w not in stopwords]

    scroll_body: dict = {"limit": 500, "with_payload": True, "with_vector": False}
    if disabled_docs:
        scroll_body["filter"] = {
            "must_not": [
                {"key": "filename", "match": {"value": doc}}
                for doc in disabled_docs
            ]
        }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{QDRANT_URL}/collections/netact_knowledgebase/points/scroll",
                json=scroll_body
            )
            resp.raise_for_status()
            points = resp.json().get("result", {}).get("points", [])

        scored = []
        for p in points:
            payload = p.get("payload", {})
            text = payload.get("text", "").lower()
            score = sum(
                1 + (0.5 if re.search(rf"\b{re.escape(kw)}\b", text) else 0)
                for kw in keywords if kw in text
            )
            if score > 0:
                scored.append({"filename": payload.get("filename", "unknown"), "page": payload.get("page", 1), "text": payload.get("text", ""), "score": score})

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:limit]

    except Exception as e:
        logger.error(f"Qdrant keyword scroll also failed: {e}")
        return []

def find_graphify_json():
    import os, glob as _glob
    vault_path = os.getenv("VAULT_PATH", "/app/obsidian_topology")
    base_dir = os.path.join(vault_path, "graphify-out")
    # Root graph.json (written by older graphify versions)
    root = os.path.join(base_dir, "graph.json")
    if os.path.exists(root):
        return root
    # Dated subdirectories — pick the most recent one lexicographically
    dated = _glob.glob(os.path.join(base_dir, "*/graph.json"))
    if dated:
        return max(dated)
    # Legacy paths (pre-restructure)
    legacy = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "obsidian_topology", "graphify-out", "graph.json")),
    ]
    for p in legacy:
        if os.path.exists(p):
            return p
    return None

def query_graphify_facts(query: str) -> str:
    """Finds matching nodes and neighbors in Graphify graph.json based on query keywords."""
    import json
    import os
    import re
    from difflib import SequenceMatcher

    path = find_graphify_json()
    if not path:
        return ""
        
    try:
        with open(path, "r", encoding="utf-8") as f:
            graph_data = json.load(f)
            
        nodes = graph_data.get("nodes", [])
        edges = graph_data.get("links", []) or graph_data.get("edges", [])
        
        words = re.findall(r"\b[a-zA-Z0-9_-]+\b", query.lower())
        stopwords = {
            "what", "is", "the", "of", "for", "in", "on", "a", "an", "and", "or", "to", "from", "at", "by", "with", "about",
            "if", "goes", "down", "up", "will", "be", "affected", "affect", "affects", "customer", "customers", "service", "services",
            "go", "does", "do", "how", "what", "where", "why", "who", "which", "when", "can", "could", "should", "would", "any", "some"
        }
        keywords = [w for w in words if w not in stopwords and len(w) >= 3]
        device_regex = r'^(?:isp|es|wac|ktc|ktr|wbc|dr|pe|p|rr|sw|ce|olt|bng)\d*$'
        for w in words:
            if re.match(device_regex, w) and w not in keywords:
                keywords.append(w)
        
        if not keywords:
            return ""
            
        def is_fuzzy_match(word, target):
            word = word.lower()
            target = target.lower()
            if len(word) <= 2 or len(target) <= 2:
                return word == target
            if word in target or target in word:
                return True
            if len(word) > 4 and len(target) > 4:
                if SequenceMatcher(None, word, target).ratio() >= 0.8:
                    return True
            return False

        matched_node_ids = set()
        matched_node_labels = {}
        for node in nodes:
            label = node.get("label", "")
            node_id = node.get("id")
            label_words = re.findall(r"\b[a-zA-Z0-9_-]+\b", label.lower())
            if any(any(is_fuzzy_match(kw, lw) for lw in label_words) for kw in keywords):
                matched_node_ids.add(node_id)
                matched_node_labels[node_id] = label
                
        if not matched_node_ids:
            return ""
            
        facts = []
        for edge in edges:
            src = edge.get("source")
            tgt = edge.get("target")
            relation = edge.get("relation", "related_to")
            
            if src in matched_node_ids or tgt in matched_node_ids:
                src_label = matched_node_labels.get(src)
                if not src_label:
                    src_label = next((n.get("label") for n in nodes if n.get("id") == src), src)
                tgt_label = matched_node_labels.get(tgt)
                if not tgt_label:
                    tgt_label = next((n.get("label") for n in nodes if n.get("id") == tgt), tgt)
                facts.append(f"  - `{src_label}` --{relation}--> `{tgt_label}`")
                
        if facts:
            header = f"=== KNOWLEDGE GRAPH RELATIONSHIPS (GRAPHIFY) ==="
            body = "\n".join(set(facts[:15]))
            return f"{header}\n{body}\n"
    except Exception as e:
        logger.error(f"Error querying Graphify facts: {e}")
        
    return ""

# ---------------------------------------------------------------------------
# 3. Live Topology API Query (real-time, no cache)
# ---------------------------------------------------------------------------

TOPOLOGY_API = os.getenv("TOPOLOGY_API", "http://NETAct_topology_backend:8001")
_TOPO_KEY    = os.getenv("APP_PASSWORD", "") or os.getenv("API_KEY", "")
_TOPO_HDRS   = {"X-Api-Key": _TOPO_KEY} if _TOPO_KEY else {}

async def query_topology_api_live(query: str, device: str = None) -> str:
    """Query Topology API directly for live device/link status. Zero cache — always current."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{TOPOLOGY_API}/topology", headers=_TOPO_HDRS)
            if resp.status_code != 200:
                return ""
            topo = resp.json()
    except Exception as e:
        logger.error("Live topology query failed: %s", e)
        return ""

    nodes = topo.get("nodes", [])
    edges = topo.get("edges", [])
    real_nodes = [n for n in nodes if not n.get("node_type")]

    if device:
        # Device-specific: find matching node
        dev_lower = device.lower()
        matched = [
            n for n in real_nodes
            if dev_lower in n.get("id", "").lower()
            or dev_lower in n.get("hostname", "").lower()
        ]
        if not matched:
            return f"=== LIVE TOPOLOGY: Device '{device}' not found in topology ===\n"

        results = []
        for node in matched[:3]:
            node_id = node["id"]
            status   = node.get("status", "unknown")
            vendor   = node.get("vendor", "unknown")
            icon     = {"ok": "🟢", "error": "🔴", "auth_fail": "🔒", "unknown": "⚫"}.get(status, "⚫")

            neighbors = []
            for e in edges:
                if e.get("source") == node_id:
                    peer, li = e["target"], e.get("local_interface", "?")
                elif e.get("target") == node_id:
                    peer, li = e["source"], e.get("remote_port", "?")
                else:
                    continue
                proto  = e.get("protocol", "?").upper()
                estate = e.get("status", "ok")
                badge  = "🟢" if estate == "ok" else "🔴"
                neighbors.append(f"    {badge} {peer} via {li} [{proto}]")

            # Fetch live healthcheck KPIs
            kpi_lines = []
            try:
                async with httpx.AsyncClient(timeout=8.0) as hc_client:
                    hc_resp = await hc_client.get(f"{TOPOLOGY_API}/healthchecks/{node_id}", headers=_TOPO_HDRS)
                    if hc_resp.status_code == 200:
                        hc = hc_resp.json()
                        for cmd, blk in (hc.get("analysis") or {}).items():
                            s  = blk.get("summary", "")
                            st = blk.get("status", "ok")
                            if s:
                                i = {"ok": "✅", "warning": "⚠️", "error": "🔴"}.get(st, "ℹ️")
                                kpi_lines.append(f"    {i} {cmd}: {s}")
            except Exception:
                pass

            block = (
                f"Device : {node_id}\n"
                f"Status : {icon} {status}\n"
                f"Vendor : {vendor}  IP: {node.get('ip','N/A')}\n"
                f"Links  : {len(neighbors)}\n"
                + ("\n".join(neighbors[:8]) or "    (none)") + "\n"
                + "Live KPIs:\n"
                + ("\n".join(kpi_lines[:6]) or "    No healthcheck data")
            )
            results.append(block)

        header = "=== LIVE DEVICE STATUS (real-time from Topology API) ==="
        return header + "\n" + "\n---\n".join(results) + "\n"

    else:
        # Network-wide summary
        total   = len(real_nodes)
        ok      = sum(1 for n in real_nodes if n.get("status") == "ok")
        error   = sum(1 for n in real_nodes if n.get("status") in ("error", "auth_fail"))
        unknown = total - ok - error
        down_links = [e for e in edges if e.get("status") == "error"]

        lines = [
            "=== LIVE NETWORK STATUS (real-time from Topology API) ===",
            f"Devices : {total} total  🟢 {ok} reachable  🔴 {error} error  ⚫ {unknown} unknown",
            f"Links   : {len(edges)} total  🔴 {len(down_links)} down",
        ]
        if error:
            bad = [n["id"] for n in real_nodes if n.get("status") in ("error", "auth_fail")]
            lines.append("Failing devices: " + ", ".join(bad[:10]))
        if down_links:
            lines.append("Down links:")
            for e in down_links[:5]:
                lines.append(f"  🔴 {e.get('source')} ↔ {e.get('target')} [{e.get('protocol','?').upper()}]")
        return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# 3a. Live Protocol Neighbor Count (real-time, no cache, no LLM)
# ---------------------------------------------------------------------------

async def count_protocol_neighbors(device: str, protocol: str) -> Optional[int]:
    """Counts live topology edges of a given protocol (bgp/ospf/lldp/isis) touching
    a device. This is the authoritative count — it reflects current topology graph
    state, not a point-in-time CLI snapshot that may be stale or count differently
    (e.g. admin-down peers). Returns None if the device isn't found or the API
    is unavailable."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{TOPOLOGY_API}/topology", headers=_TOPO_HDRS)
            if resp.status_code != 200:
                return None
            topo = resp.json()
    except Exception as e:
        logger.error("Live protocol-neighbor-count query failed: %s", e)
        return None

    nodes = topo.get("nodes", [])
    edges = topo.get("edges", [])
    real_nodes = [n for n in nodes if not n.get("node_type")]

    dev_lower = device.lower()
    matched = [
        n for n in real_nodes
        if dev_lower in n.get("id", "").lower()
        or dev_lower in n.get("hostname", "").lower()
    ]
    if not matched:
        return None
    node_id = matched[0]["id"]

    protocol_lower = protocol.lower()
    return sum(
        1 for e in edges
        if (e.get("source") == node_id or e.get("target") == node_id)
        and (e.get("protocol") or "").lower() == protocol_lower
    )


async def get_protocol_neighbor_status(device: str, protocol: str) -> Optional[dict]:
    """Like count_protocol_neighbors, but broken down by edge status (up/down) —
    for follow-up questions like 'how many are up and how many are down'.
    Returns None if the device isn't found or the API is unavailable."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{TOPOLOGY_API}/topology", headers=_TOPO_HDRS)
            if resp.status_code != 200:
                return None
            topo = resp.json()
    except Exception as e:
        logger.error("Live protocol-neighbor-status query failed: %s", e)
        return None

    nodes = topo.get("nodes", [])
    edges = topo.get("edges", [])
    real_nodes = [n for n in nodes if not n.get("node_type")]

    dev_lower = device.lower()
    matched = [
        n for n in real_nodes
        if dev_lower in n.get("id", "").lower()
        or dev_lower in n.get("hostname", "").lower()
    ]
    if not matched:
        return None
    node_id = matched[0]["id"]

    protocol_lower = protocol.lower()
    matching_edges = [
        e for e in edges
        if (e.get("source") == node_id or e.get("target") == node_id)
        and (e.get("protocol") or "").lower() == protocol_lower
    ]
    up = sum(1 for e in matching_edges if (e.get("status") or "ok").lower() == "ok")
    down = len(matching_edges) - up
    return {"total": len(matching_edges), "up": up, "down": down}


# ---------------------------------------------------------------------------
# 3b. Live EOL/EOS Compliance API Query (real-time, no cache, no LLM)
# ---------------------------------------------------------------------------

BACKEND_API = os.getenv("BACKEND_API", "http://NETAct_backend:8000")

async def query_eoleos_compliance_live(device: str = None) -> Optional[list]:
    """Query core backend's /eoleos-compliance directly for live EOL/EOS status. Zero cache, zero LLM."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{BACKEND_API}/eoleos-compliance", headers=_TOPO_HDRS)
            if resp.status_code != 200:
                return None
            records = resp.json()
    except Exception as e:
        logger.error("Live EOL/EOS compliance query failed: %s", e)
        return None

    if device:
        dev_lower = device.lower()
        records = [
            r for r in records
            if dev_lower in (r.get("hostname") or "").lower()
            or dev_lower in str(r.get("device_id") or "").lower()
        ]
    return records


async def analyze_healthcheck_summary(device: str) -> Optional[str]:
    """Structured per-command healthcheck summary for one device — status +
    one-line summary per command (interface counts, adjacency state, etc.),
    same data Brain's device notes use for their KPI Summary section.

    Deliberately NOT the raw healthcheck text (see query_healthcheck_section /
    show_config for that) — a busy router's full healthcheck can run into
    megabytes of raw CLI output, useless to dump into a chat response. This
    is what "analyze logs" should mean: a digested read, not everything.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{TOPOLOGY_API}/healthchecks/{device}", headers=_TOPO_HDRS)
            if resp.status_code != 200:
                return None
            hc = resp.json()
    except Exception as e:
        logger.error("Healthcheck summary query failed for %s: %s", device, e)
        return None

    analysis = hc.get("analysis") or {}
    if not analysis:
        return None

    lines = []
    problems = []
    for cmd, blk in analysis.items():
        status  = blk.get("status", "ok")
        summary = blk.get("summary", "")
        if not summary:
            continue
        icon = {"ok": "✅", "warning": "⚠️", "error": "🔴", "critical": "🔴"}.get(status, "ℹ️")
        line = f"{icon} **{cmd}**: {summary}"
        lines.append(line)
        if status not in ("ok",):
            problems.append(line)

    if not lines:
        return None

    parts = [f"### 🩺 Healthcheck Analysis — **{device}**\n"]
    if problems:
        parts.append("**Issues found:**\n" + "\n".join(f"- {p}" for p in problems) + "\n")
    parts.append("**Full command summary:**\n" + "\n".join(f"- {l}" for l in lines))
    ts = hc.get("timestamp")
    if ts:
        try:
            from datetime import datetime, timezone
            parts.append(f"\n*Healthcheck collected: {datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}*")
        except Exception:
            pass
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# 4. Hybrid Retrieval Pipeline
# ---------------------------------------------------------------------------

# Filename patterns that indicate live device logs/telemetry rather than documentation.
# These are never useful as context for general knowledge questions.
_TELEMETRY_PATTERNS = ("healthcheck_", "healthcheck-", "backup_", "backup-", "telemetry_", "syslog_")

_AMBIGUITY_SCORE_GAP = 0.05

def _is_retrieval_ambiguous(hits: list[dict]) -> bool:
    """True when 2+ chunks from genuinely different sources (filename+page)
    score within _AMBIGUITY_SCORE_GAP of the top hit. Self-reported model
    confidence is unreliable here by design — the model has no way to know
    it picked a supplementary/secondary chunk over the real answer when both
    look equally relevant by similarity score. Confirmed against a real
    failure: a supplementary-feature chunk (0.8452) and the actual baseline
    procedure chunk (0.816) scored within 0.03 of each other — genuinely
    ambiguous by this measure, and the model did in fact pick the wrong one.
    This is a cheap, deterministic, evidence-based signal that doesn't
    depend on the model's own (unreliable) self-assessment at all."""
    if len(hits) < 2:
        return False
    top_score = hits[0].get("score", 0.0)
    seen = {(hits[0].get("filename"), hits[0].get("page"))}
    for h in hits[1:]:
        key = (h.get("filename"), h.get("page"))
        if key in seen:
            continue  # same source, not a competing alternative
        if top_score - h.get("score", 0.0) <= _AMBIGUITY_SCORE_GAP:
            return True
        seen.add(key)
    return False


_CHUNK_LOOKAHEAD = 2

async def _expand_with_following_chunks(hit: dict) -> str:
    """Stitches in the next _CHUNK_LOOKAHEAD chunks from the same file right
    after this hit's chunk_index. At chunk_size=350 chars, a single chunk
    routinely ends mid-sentence right before the actual content a query
    needs — confirmed live: the top-ranked, correctly-matched chunk for "BGP
    configuration" was the real section intro, but it cut off at "...To
    build a BGP network, conf[igure...]" exactly where the real steps would
    start. The following chunk(s) from the same document are the cheapest
    way to recover that content without re-embedding anything — a pure
    lookup by filename+chunk_index, no new vector search involved."""
    text = hit.get("text", "")
    filename = hit.get("filename")
    idx = hit.get("chunk_index")
    page = hit.get("page")
    if filename is None or idx is None or page is None:
        return text

    async def _fetch(page_val, chunk_indices, limit):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{QDRANT_URL}/collections/netact_knowledgebase/points/scroll",
                    json={
                        "limit": limit,
                        "with_payload": True,
                        "with_vector": False,
                        "filter": {
                            "must": [
                                {"key": "filename", "match": {"value": filename}},
                                {"key": "page", "match": {"value": page_val}},
                                {"key": "chunk_index", "match": {"any": chunk_indices}},
                            ]
                        },
                    },
                )
                resp.raise_for_status()
                return resp.json().get("result", {}).get("points", [])
        except Exception as e:
            logger.warning(f"Chunk lookahead fetch failed for {filename}#{page_val}: {e}")
            return []

    # chunk_index resets to 0 per page (vector_sync.py chunks page-by-page),
    # so lookahead must stay within the same page — matching by filename
    # alone previously pulled in chunk 1-2 of a totally unrelated page
    # (confirmed live: an OSPF routing table for a BGP query). But a page's
    # last chunk is exactly where a section intro commonly ends right before
    # its numbered steps, which start on the NEXT page — confirmed live too
    # ("...including the following steps:" then straight to the page
    # footer). So: fill the lookahead budget from this page first, then
    # spill onto page+1 chunk 0.. for whatever's left.
    same_page = await _fetch(page, list(range(idx + 1, idx + 1 + _CHUNK_LOOKAHEAD)), _CHUNK_LOOKAHEAD)
    remaining = _CHUNK_LOOKAHEAD - len(same_page)
    next_page = await _fetch(page + 1, list(range(0, remaining)), remaining) if remaining > 0 else []

    for p in sorted(same_page, key=lambda p: p["payload"].get("chunk_index", idx)):
        text += p["payload"].get("text", "")
    for p in sorted(next_page, key=lambda p: p["payload"].get("chunk_index", 0)):
        text += p["payload"].get("text", "")
    return text


async def run_hybrid_retrieval(query: str, disabled_docs: list[str] = [], intent: str = "") -> tuple[str, bool]:
    """
    Executes Graphify knowledge and Qdrant REST queries, prioritizing structured facts
    at the top of the context envelope. Returns (context, retrieval_ambiguous).
    """
    # 1. Fetch Graphify knowledge graph facts — skipped for general_chat
    # documentation questions unless they actually mention backup/telemetry,
    # mirroring the same exclusion already applied to the vector search
    # below. query_graphify_facts()'s fuzzy matcher does substring matching
    # (e.g. "config" inside "configuration"), and "Last Config Change" is a
    # generic label attached to nearly every device's Backup node — so any
    # query containing the very common word "config"/"configuration" (e.g.
    # "share the BGP configuration for Huawei NE9000") matched 14+ unrelated
    # devices' backup nodes and dumped their IPs into context for a pure
    # documentation question, confirmed live.
    _query_lower_for_graphify = query.lower()
    _skip_graphify = intent == "general_chat" and not any(
        k in _query_lower_for_graphify for k in ["healthcheck", "healtcheck", "backup", "incident"]
    )
    graphify_context = "" if _skip_graphify else query_graphify_facts(query)

    # general_chat previously got only the single top-scored chunk. Confirmed
    # live root cause of bad KB-doc answers: for "how do I configure X"
    # questions, the highest-scored chunk is often a supplementary/optional
    # feature (e.g. a named sub-feature keyword happens to score higher),
    # while the actual baseline/prerequisite procedure scores lower but still
    # clears score_threshold — with limit=1 the model never even saw it. Match
    # the other intents' limit so the model has the full relevant picture;
    # score_threshold (0.45) still gates out irrelevant chunks for trivial
    # queries ("hi", "what can you do"), so this doesn't add noise there.
    limit = 4
    vector_hits = await query_qdrant_vector_db(query, limit=limit, disabled_docs=disabled_docs)

    # For general knowledge questions, filter out device telemetry / log files,
    # unless the query mentions telemetry/operations keywords.
    if intent == "general_chat":
        query_lower = query.lower()
        if not any(k in query_lower for k in ["healthcheck", "healtcheck", "backup", "incident"]):
            filtered = [
                h for h in vector_hits
                if not any(h["filename"].lower().startswith(p) for p in _TELEMETRY_PATTERNS)
            ]
            if len(filtered) < len(vector_hits):
                logger.info(
                    "run_hybrid_retrieval: dropped %d telemetry doc(s) for general_chat intent.",
                    len(vector_hits) - len(filtered),
                )
            vector_hits = filtered

    vector_context = ""
    if vector_hits:
        vector_blocks = []
        for i, h in enumerate(vector_hits):
            text = await _expand_with_following_chunks(h)
            # Cap raised from 800 -> 1600 to match the now-larger stitched
            # text (original ~350-char chunk + up to 2 following chunks);
            # kept 4 hits x ~1600 chars well within num_ctx=4096 tokens once
            # combined with the prompt template and generation budget.
            text_preview = text[:1600] + '... [truncated]' if len(text) > 1600 else text
            vector_blocks.append(f"[{i+1}] Source: {h['filename']} (Page {h['page']})\nContent: {text_preview}\n")
        vector_context = "=== SEMANTIC KNOWLEDGEBASE MATCHES (QDRANT VECTOR SIMILARITY) ===\n" + "\n".join(vector_blocks)

    combined = []
    if graphify_context:
        combined.append(graphify_context)
    if vector_context:
        combined.append(vector_context)

    retrieval_ambiguous = _is_retrieval_ambiguous(vector_hits)
    return ("\n\n".join(combined) if combined else ""), retrieval_ambiguous
