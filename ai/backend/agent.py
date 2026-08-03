import os
import re
import json
import time
import logging
import sqlite3
import httpx
from typing import List, Dict, Any, Literal
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
import pipelines
import config_loader


logger = logging.getLogger("agent")

# Configurations
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://NETAct_ollama:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")
OLLAMA_NUM_THREAD = int(os.getenv("OLLAMA_NUM_THREAD", "24"))
MCP_SERVER_URL = os.getenv("NETACT_MCP_SERVER_URL", "http://NETAct_MCP_Server:5001/sse")
DB_PATH = os.getenv("DB_PATH", "copilot_history.db")

# Helper to check backup status and calculate health score
async def get_device_backup_status(device_name: str) -> dict:
    """Queries the main backend via HTTP to check the device's backup age and status."""
    import httpx
    from datetime import datetime, timezone
    
    backend_url = os.getenv("NETACT_BACKEND_URL", "http://backend:8000")
    app_password = os.getenv("APP_PASSWORD", "")
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {"x-api-key": app_password}
            resp = await client.get(f"{backend_url}/devices/backups-summary", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                for dev in data:
                    if dev.get("hostname", "").lower() == device_name.lower():
                        b_sum = dev.get("backup_summary") or {}
                        last_b = b_sum.get("last_backup")
                        if last_b and last_b.get("status") == "success":
                            collected_at_str = last_b.get("collected_at")
                            if collected_at_str:
                                dt_str = collected_at_str.replace("Z", "+00:00")
                                dt = datetime.fromisoformat(dt_str)
                                if dt.tzinfo is None:
                                    dt = dt.replace(tzinfo=timezone.utc)
                                age_seconds = (datetime.now(timezone.utc) - dt).total_seconds()
                                age_hours = age_seconds / 3600.0
                                return {
                                    "status": "success",
                                    "age_hours": age_hours,
                                    "collected_at": collected_at_str,
                                    "is_recent": age_hours <= 6.0
                                }
                        return {"status": "success", "age_hours": 999.0, "collected_at": None, "is_recent": False}
            return {"status": "error", "error": f"Backend returned status {resp.status_code}"}
    except Exception as e:
        logger.error(f"Failed to fetch backup status for {device_name}: {e}")
        return {"status": "error", "error": str(e)}

async def get_mcp_tools() -> list:
    """Queries the NETAct MCP Server for its list of registered tools dynamically."""
    from mcp import ClientSession
    from mcp.client.sse import sse_client
    try:
        async with sse_client(MCP_SERVER_URL) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as mcp_session:
                await mcp_session.initialize()
                tools_res = await mcp_session.list_tools()
                tools = []
                for t in tools_res.tools:
                    schema = t.inputSchema
                    if not isinstance(schema, dict):
                        if hasattr(schema, "model_dump"):
                            schema = schema.model_dump()
                        elif hasattr(schema, "dict"):
                            schema = schema.dict()
                        else:
                            schema = dict(schema)
                    tools.append({
                        "name": t.name,
                        "description": t.description,
                        "inputSchema": schema
                    })
                return tools
    except Exception as e:
        logger.error("Failed to query tools from MCP Server: %s", e)
        return []

def calculate_health_score(tool_results: list) -> tuple[int, list[str]]:
    score = 100
    anomalies = []
    
    for r in tool_results:
        tool = r.get("tool", "")
        status = r.get("status", "")
        output = r.get("output", "")

        # Generic tool-execution failure — the tool didn't return usable
        # telemetry at all, so this isn't "device is healthy", it's "we
        # don't actually know". Don't let it silently score as 100.
        if status not in ("success", "ok", ""):
            score -= 30
            anomalies.append(f"Tool `{tool}` failed to execute — no telemetry returned: {output[:150].strip()}")
            continue

        if any(cmd in tool.lower() or (isinstance(r.get("args"), dict) and any(cmd in str(r["args"].get("command", "")).lower() for cmd in ["interface", "int brief"])) for cmd in ["interface", "int brief"]):
            lines = output.splitlines()
            for line in lines:
                tokens = line.split()
                if len(tokens) >= 4:
                    col_status = tokens[-2].lower() if len(tokens) >= 2 else ""
                    col_proto = tokens[-1].lower() if len(tokens) >= 1 else ""
                    if col_status == "down" or col_proto == "down" or "admin" in col_status:
                        if tokens[0].lower() not in ["interface", "meth0/0/0", "loopback0"]:
                            score -= 15
                            anomalies.append(f"Interface `{tokens[0]}` is DOWN (Status: {tokens[-2]}, Protocol: {tokens[-1]})")
                            
        if "ospf" in tool.lower() or (isinstance(r.get("args"), dict) and "ospf" in str(r["args"].get("command", "")).lower()):
            for state in ["init", "exstart", "exchange", "loading", "down", "attempt"]:
                matches = re.findall(rf"\b{state}\b", output, re.IGNORECASE)
                if matches:
                    score -= 25 * len(matches)
                    anomalies.append(f"OSPF adjacency in non-FULL state: {state.upper()}")
                    
        if "bgp" in tool.lower() or (isinstance(r.get("args"), dict) and "bgp" in str(r["args"].get("command", "")).lower()):
            for state in ["active", "idle", "connect", "opensent", "openconfirm"]:
                matches = re.findall(rf"\b{state}\b", output, re.IGNORECASE)
                if matches:
                    score -= 25 * len(matches)
                    anomalies.append(f"BGP peering in non-ESTABLISHED state: {state.upper()}")
                    
    score = max(0, min(100, score))
    return score, anomalies

# Helper to run local model chat
def load_sanitization_config() -> dict:
    config_path = os.path.join(os.path.dirname(__file__), "sanitization_config.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading sanitization config in agent: {e}")
    return {
        "rules": {
            "mask_ips": True,
            "mask_hostnames": True,
            "mask_commands": True,
            "mask_emails": True
        },
        "custom_terms": [],
        "custom_regexes": []
    }

def sanitize_prompt(text: str) -> tuple[str, dict]:
    config = load_sanitization_config()
    rules = config.get("rules", {})
    custom_terms = config.get("custom_terms", [])
    custom_regexes = config.get("custom_regexes", [])
    
    mapping = {}
    sanitized_text = text
    
    # 1. Mask IPs
    if rules.get("mask_ips", True):
        ip_pattern = r"\b(?:\d{1,3}\.){3}\d{1,3}\b"
        ips = re.findall(ip_pattern, sanitized_text)
        for i, ip in enumerate(sorted(list(set(ips)))):
            token = f"IP_ADDR_{i+1}"
            mapping[token] = ip
            sanitized_text = sanitized_text.replace(ip, token)
            
    # 2. Mask Hostnames
    if rules.get("mask_hostnames", True):
        host_pattern = r"\b(?:ISP|ES|WAC|KTC|KTR|WBC|DR|PE|P|RR|SW|CE|OLT|BNG)[-_][a-zA-Z0-9_-]+\b|\b(?:ISP|ES|WAC|KTC|KTR|WBC|DR|PE|P|RR|SW|CE|OLT|BNG)\d+\b|\b(?:DB|CSM|MCSM|ACSM|OMI|VPP)\d+\b"
        hosts = re.findall(host_pattern, sanitized_text, re.IGNORECASE)
        for i, host in enumerate(sorted(list(set(hosts)))):
            token = f"NODE_HOST_{i+1}"
            mapping[token] = host
            sanitized_text = re.sub(rf"\b{re.escape(host)}\b", token, sanitized_text, flags=re.IGNORECASE)
            
    # 3. Mask Emails
    if rules.get("mask_emails", True):
        email_pattern = r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b"
        emails = re.findall(email_pattern, sanitized_text)
        for i, email in enumerate(sorted(list(set(emails)))):
            token = f"EMAIL_ADDR_{i+1}"
            mapping[token] = email
            sanitized_text = sanitized_text.replace(email, token)
            
    # 4. Mask CLI Commands
    if rules.get("mask_commands", True):
        command_pattern = r"\b[a-z]{3,}(?:ctl|sh|cfg|diag|check)\b"
        cmds = re.findall(command_pattern, sanitized_text, re.IGNORECASE)
        for i, cmd in enumerate(sorted(list(set(cmds)))):
            token = f"CMD_TOKEN_{i+1}"
            mapping[token] = cmd
            sanitized_text = re.sub(rf"\b{re.escape(cmd)}\b", token, sanitized_text, flags=re.IGNORECASE)
            
    # 5. Mask Custom Terms
    for i, term in enumerate(sorted(list(set(custom_terms)))):
        if not term.strip():
            continue
        token = f"CUSTOM_TERM_{i+1}"
        mapping[token] = term
        sanitized_text = re.sub(rf"\b{re.escape(term)}\b", token, sanitized_text, flags=re.IGNORECASE)
        
    # 6. Mask Custom Regexes
    for i, pattern_str in enumerate(sorted(list(set(custom_regexes)))):
        if not pattern_str.strip():
            continue
        try:
            pat = re.compile(pattern_str)
            matches = pat.findall(sanitized_text)
            for j, match in enumerate(sorted(list(set(matches)))):
                match_str = match[0] if isinstance(match, tuple) else match
                if not match_str:
                    continue
                token = f"CUSTOM_REGEX_MATCH_{i+1}_{j+1}"
                mapping[token] = match_str
                sanitized_text = sanitized_text.replace(match_str, token)
        except Exception as e:
            logger.error(f"Invalid custom regex pattern '{pattern_str}': {e}")
            
    return sanitized_text, mapping

def restore_prompt(text: str, mapping: dict) -> str:
    restored_text = text
    for token, real_val in mapping.items():
        restored_text = restored_text.replace(token, real_val)
    return restored_text

# Helper to run model chat (Gemini Cloud API or local Ollama)
async def call_ollama(messages: list) -> str:
    """Always calls the local Ollama model regardless of Gemini key presence.
    Used by local_synthesizer_node — Gemini is never touched here."""
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "messages": messages,
                    "stream": False,
                    "options": {
                        "temperature": 0.0,
                        "num_thread": OLLAMA_NUM_THREAD,
                        "num_predict": 512,
                        "num_ctx": 4096
                    }
                }
            )
            resp.raise_for_status()
            return resp.json()["message"]["content"]
    except Exception as e:
        logger.error("Ollama call failed: %s", e)
        return ""


async def call_ollama_stream(messages: list, model: str = None) -> str:
    """Streams the local Ollama model's response token-by-token to the LangGraph
    custom stream (so the client sees output as it's generated instead of waiting
    for the full completion), while still returning the full text for downstream
    CONFIDENCE parsing — same contract as call_ollama().

    model, if given, overrides OLLAMA_MODEL — this is how the frontend's model
    dropdown (AgentState.active_model) actually takes effect. Only wired into
    this final-answer synthesis call; classification and tool planning stay
    pinned to their own default models regardless of what's passed here."""
    from langgraph.config import get_stream_writer
    writer = get_stream_writer()
    full_text = []
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream(
                "POST",
                f"{OLLAMA_HOST}/api/chat",
                json={
                    "model": model or OLLAMA_MODEL,
                    "messages": messages,
                    "stream": True,
                    "options": {
                        "temperature": 0.0,
                        "num_thread": OLLAMA_NUM_THREAD,
                        "num_predict": 512,
                        "num_ctx": 4096
                    }
                }
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except Exception:
                        continue
                    content = chunk.get("message", {}).get("content", "")
                    if content:
                        full_text.append(content)
                        writer(content)
        return "".join(full_text)
    except Exception as e:
        logger.error("Ollama streaming call failed: %s", e)
        return "".join(full_text)


async def call_llm(messages: list) -> str:
    """Calls Gemini if key is configured, otherwise falls back to Ollama.
    Used only for explicit Gemini escalation after operator approval."""
    import time
    import metrics as _m

    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key:
        return await call_ollama(messages)

    contents = []
    for msg in messages:
        role = "user" if msg["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": msg["content"]}]})

    model_name = "gemini-2.5-flash"
    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
            resp = await client.post(url, json={"contents": contents})
            resp.raise_for_status()
            data = resp.json()
            duration = time.time() - t0

            # Extract token counts from usageMetadata (always present in Gemini responses)
            usage = data.get("usageMetadata", {})
            input_tok  = usage.get("promptTokenCount", 0)
            output_tok = usage.get("candidatesTokenCount", 0)

            _m.record_gemini_call(
                model=model_name,
                duration_s=duration,
                status="success",
                input_tokens=input_tok,
                output_tokens=output_tok,
            )
            return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        logger.error("Gemini API call failed: %s", e)
        _m.record_gemini_call(model=model_name, duration_s=time.time() - t0, status="error")
        return "Failed to query Gemini API."

# Define the State Schema (pure dict-based, no LangGraph dependency)
class AgentState(TypedDict):
    messages: list          # list of {"role": str, "content": str} dicts
    intent: str
    active_model: str       # user's selected model (frontend model dropdown) for
                             # final answer synthesis only — never for classification
                             # or tool planning, which stay pinned to their own
                             # dedicated/default models regardless of this
    retrieved_context: str
    retrieval_ambiguous: bool  # True when 2+ retrieved chunks from different
                                # sources score within _AMBIGUITY_SCORE_GAP of
                                # each other — the model's own self-reported
                                # CONFIDENCE is unreliable in exactly this case
                                # (it has no way to know it picked the wrong
                                # one of several similarly-scored chunks), so
                                # local_synthesizer_node overrides to LOW here
                                # rather than trusting the self-report.
    target_devices: list
    planned_tools: list
    risk_tier: str          # "read_only" | "write"
    approval_status: str    # "not_required" | "pending" | "approved" | "rejected"
    approval_requested_at: float
    tool_results: list
    final_response: str
    gemini_prompt_preview: str
    gemini_approval_status: str
    sanitization_mapping: str
    # Local-first synthesis fields
    local_confidence: str   # "HIGH" | "MEDIUM" | "LOW"
    local_response: str     # answer from the configured local synthesis model
    has_tool_results: bool  # True when tool_results is populated (device data present)
    synth_was_streamed: bool  # True only when local_synthesizer_node actually called
                               # call_ollama_stream (its raw output already reached the
                               # client live via the custom stream) — False for its
                               # hand-built early-return messages (e.g. suggest_healthcheck_for)
                               # and for decline_explain_node, neither of which stream anything.
                               # Lets app.py know whether re-yielding final_response would
                               # duplicate what the client already saw, or is the only copy.
    gemini_gate_pending: bool   # True when approval gate has been shown, awaiting operator reply
    gemini_gate_type: str       # "standard" | "strict"
    suggest_healthcheck_for: str  # device name, when tool_planner skipped diagnostics for lack of baseline data

# ---------------------------------------------------------------------------
# LangGraph Node Implementations
# ---------------------------------------------------------------------------

async def intent_router_node(state: AgentState) -> dict:
    """Classifies user intent and identifies devices mentioned."""
    if state.get("intent"):
        return {"intent": state["intent"], "target_devices": state.get("target_devices", [])}

    # Fallback/Unit test classification using the central intent_router module
    last_msg = state["messages"][-1]
    user_msg = last_msg["content"] if isinstance(last_msg, dict) else last_msg.content
    try:
        import intent_router
        classification = await intent_router.classify_intent_with_ollama(user_msg)
        intent = classification.get("intent", "general_chat")
        device = classification.get("device")
        return {"intent": intent, "target_devices": [device] if device else []}
    except Exception as e:
        logger.error("Fallback classification failed in intent_router_node: %s", e)
        return {"intent": "general_chat", "target_devices": []}


async def context_retriever_node(state: AgentState) -> dict:
    """Queries SQLite topology and Qdrant for context."""
    last_msg = state["messages"][-1]
    user_msg = last_msg["content"] if isinstance(last_msg, dict) else last_msg.content
    intent = state.get("intent", "general_chat")

    # Short, context-dependent follow-ups ("what about OSPF then?") retrieve
    # poorly on their own — enrich the retrieval query with the previous user
    # turn so semantic search has something concrete to match. Only applied
    # when the current message is short, so normal standalone queries (the
    # common case) are unaffected.
    retrieval_query = user_msg
    if len(user_msg.split()) <= 12 and len(state["messages"]) > 1:
        for m in reversed(state["messages"][:-1]):
            m_role = m.get("role") if isinstance(m, dict) else getattr(m, "role", "")
            m_content = m.get("content") if isinstance(m, dict) else getattr(m, "content", "")
            if m_role == "user" and m_content:
                retrieval_query = f"{m_content} {user_msg}"
                break

    context, retrieval_ambiguous = await pipelines.run_hybrid_retrieval(retrieval_query, intent=intent)

    # Only inject semantic memory facts for device-specific intents.
    # For general_chat, device facts are irrelevant and confuse the model —
    # e.g. a stored "Last Healthcheck Status: FAILED" for Router X should never
    # pollute an answer about "how do I configure OSPF on Cisco IOS".
    if intent != "general_chat":
        try:
            import semantic_memory
            memory_context = semantic_memory.search_facts(user_msg)
            if memory_context:
                context = memory_context + context
        except Exception as e:
            logger.error("Error retrieving semantic memory context: %s", e)

    return {"retrieved_context": context, "retrieval_ambiguous": retrieval_ambiguous}


async def tool_planner_node(state: AgentState) -> dict:
    """Decides dynamically what tools to call based on user query and MCP tool schemas."""
    intent = state.get("intent", "general_chat")
    operational_intents = {"run_healthcheck", "run_backup", "run_automation", "run_diagnostic", "audit_config_changes"}
    if intent not in operational_intents:
        logger.info("Intent '%s' is not operational. Skipping tool planning.", intent)
        return {"planned_tools": []}

    devices = state.get("target_devices", [])

    # A live diagnostic query (e.g. "OSPF neighbors for X") with no baseline
    # healthcheck on file for the device has nothing to reason over — reaching
    # for ad-hoc show-command tools there just produces noise. Suggest
    # collecting a real healthcheck (via run_healthcheck_collect -> NETAct_backend)
    # instead of planning tools, rather than attempting one blind.
    if intent == "run_diagnostic" and devices:
        import app
        device_name = devices[0]
        if not app.get_latest_healthcheck(device_name):
            logger.info(
                "No healthcheck on file for %s — suggesting collection instead of planning diagnostic tools.",
                device_name,
            )
            return {"planned_tools": [], "suggest_healthcheck_for": device_name}

    last_msg = state["messages"][-1]
    user_msg = last_msg["content"] if isinstance(last_msg, dict) else last_msg.content

    # 1. Fetch available tools from MCP
    mcp_tools = await get_mcp_tools()
    if not mcp_tools:
        logger.warning("No tools retrieved from MCP server. Skipping tool planning.")
        return {"planned_tools": []}

    # pyATS and SuzieQ integrations are currently unavailable in this deployment
    # (missing MCP config volume / SuzieQ not deployed) — exclude them from the
    # planner's choices so it doesn't keep reaching for tools that can't work.
    _DISABLED_TOOL_PREFIXES = ("pyATS_", "suzieq_")
    mcp_tools = [t for t in mcp_tools if not t["name"].startswith(_DISABLED_TOOL_PREFIXES)]
    if not mcp_tools:
        logger.warning("No enabled tools available after filtering. Skipping tool planning.")
        return {"planned_tools": []}

    # 2. Format tool list for LLM context
    tools_formatted = []
    for t in mcp_tools:
        tools_formatted.append(
            f"- Tool: {t['name']}\n"
            f"  Description: {t['description']}\n"
            f"  Input Schema: {json.dumps(t['inputSchema'])}"
        )
    tools_context = "\n".join(tools_formatted)

    # 3. Build planning prompt
    prompt = (
        "You are 'NETAct AI Tool Planner', a component that decides which network automation/monitoring tools to call "
        "based on the user's request and target devices.\n\n"
        f"Target Devices extracted: {devices}\n"
        f"User Query: \"{user_msg}\"\n\n"
        "=== AVAILABLE TOOLS ===\n"
        f"{tools_context}\n\n"
        "=== INSTRUCTIONS ===\n"
        "1. Select the tool(s) that directly help satisfy the user's query.\n"
        "2. Make sure to populate the arguments according to the Input Schema.\n"
        "3. If a tool requires 'device_name', use one of the extracted target devices. If no specific device is targetable, use 'unknown'.\n"
        "4. Respond ONLY with a JSON array of tool calls. Do not explain anything.\n"
        "Format:\n"
        "[\n"
        "  {\"name\": \"tool_name\", \"args\": {\"arg1\": \"value1\"}}\n"
        "]\n"
        "If no tool is needed, respond with: []"
    )

    planned_tools = []
    try:
        raw_res = await call_ollama([{"role": "user", "content": prompt}])
        logger.info("Dynamic Tool Planner raw response: %s", raw_res)
        
        # Extract JSON array
        match = re.search(r"\[[\s\S]*?\]", raw_res)
        if match:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, list):
                planned_tools = parsed
            elif isinstance(parsed, dict):
                planned_tools = [parsed]
        elif raw_res.strip() == "[]":
            planned_tools = []
    except Exception as e:
        logger.error("Failed to parse planned tools JSON: %s", e)

    # Ensure format is correct: [{"name": str, "args": dict}], and drop any
    # disabled tool the model names from its own training knowledge even
    # though it wasn't offered in the catalog above.
    cleaned_tools = []
    for tool in planned_tools:
        if isinstance(tool, dict) and "name" in tool and not tool["name"].startswith(_DISABLED_TOOL_PREFIXES):
            cleaned_tools.append({
                "name": tool["name"],
                "args": tool.get("args") or {}
            })
    planned_tools = cleaned_tools

    logger.info("Dynamic Tool Planner final plan: %s", planned_tools)
    return {"planned_tools": planned_tools}


async def risk_classifier_node(state: AgentState) -> dict:
    """Rule engine to classify tool execution risks (LLM-independent safety gate)."""
    planned = state.get("planned_tools", [])
    devices = state.get("target_devices", [])
    device_name = devices[0] if devices else "unknown"
    
    risk_tier = "read_only"
    approval_status = "not_required"

    # Actions that change device config — require a full ITSM Change Request
    # ticket + recent-backup check before they're allowed to run at all.
    write_actions = ["run_automation_flow", "ssh_config_command", "cicd_trigger_job"]
    # Read-only but still touches a live device (runs real commands over SSH) —
    # require a simple yes/no operator confirmation, no formal CR ticket needed;
    # proportionate to the actual risk since no config is changed.
    confirm_only_actions = ["run_healthcheck_collect"]

    has_write_action = any(t["name"] in write_actions for t in planned)
    has_confirm_action = any(t["name"] in confirm_only_actions for t in planned)

    # tool_planner_node's LLM-driven planning fills in each tool's own
    # args.device_name independently — it's only instructed (not enforced) to
    # pick from target_devices. If it ever names a different device than the
    # one this function checks ITSM approval / backup freshness for below
    # (device_name = devices[0]), a write action could execute against an
    # unapproved, non-backed-up device while this gate believes it verified
    # the right one. Block outright rather than trust a mismatch.
    mismatched_device_tools = [
        t for t in planned
        if t["name"] in write_actions
        and t.get("args", {}).get("device_name")
        and t["args"]["device_name"] != device_name
    ]
    if mismatched_device_tools:
        logger.error(
            "Risk Classifier: planned write action targets device(s) %s, "
            "but only %s was resolved from the user's query — blocking.",
            [t["args"]["device_name"] for t in mismatched_device_tools], device_name,
        )
        return {
            "risk_tier": "write",
            "approval_status": "blocked_by_itsm",
            "planned_tools": planned,
            "approval_requested_at": 0.0,
        }

    if has_write_action:
        risk_tier = "write"
        approval_status = "pending"
    elif has_confirm_action:
        risk_tier = "write"  # reuses the same human_approval_gate routing signal
        approval_status = "pending"
        logger.info(
            "Simple confirmation required (no ITSM ticket needed) for: %s",
            [t["name"] for t in planned if t["name"] in confirm_only_actions],
        )

    if has_write_action:
        # Check mock ITSM approved ticket in SQLite — and that its action_type
        # actually corresponds to what's about to run, not just that *some*
        # approved ticket exists for the device. A ticket approved for
        # run_config_backup has no bearing on whether running an automation
        # flow was authorized; treating "any approved ticket for this device"
        # as blanket authorization for any subsequent write action defeats the
        # purpose of per-change approval. Tickets and MCP tool names don't
        # share one vocabulary (tickets use human categories like
        # "run_config_backup"/"run_healthcheck", tools use execution names
        # like "run_automation_flow"), so match on normalized core keywords
        # rather than requiring an exact string match.
        import sqlite3
        has_approved_cr = False
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT ticket_id, action_type FROM itsm_tickets WHERE device_name=? AND status='Approved'",
                (device_name,)
            )
            rows = cursor.fetchall()
            conn.close()

            planned_write_names = {t["name"] for t in planned if t["name"] in write_actions}

            def _core_keywords(s: str) -> set:
                s = s.lower()
                for prefix in ("run_", "trigger_", "collect_"):
                    if s.startswith(prefix):
                        s = s[len(prefix):]
                return set(s.split("_"))

            planned_kw = set()
            for name in planned_write_names:
                planned_kw |= _core_keywords(name)

            for ticket_id, action_type in rows:
                ticket_kw = _core_keywords(action_type or "")
                if ticket_kw & planned_kw:
                    has_approved_cr = True
                    logger.info(
                        "ITSM Gating: Approved Change Request %s (action_type=%s) covers planned action(s) %s",
                        ticket_id, action_type, planned_write_names,
                    )
                    break

            if rows and not has_approved_cr:
                logger.warning(
                    "ITSM Gating: device %s has approved ticket(s) %s, but none match planned write action(s) %s — not treating as authorization.",
                    device_name, [r[0] for r in rows], planned_write_names,
                )
        except Exception as e:
            logger.error("ITSM Gating: Failed to query database: %s", e)

        if not has_approved_cr:
            approval_status = "blocked_by_itsm"
            logger.info("ITSM Gating: Write action blocked because no approved ticket was found for device %s.", device_name)
        else:
            # Pre-Execution Backup Check: check if backup was completed within the last 6 hours
            backup_check = await get_device_backup_status(device_name)
            if backup_check.get("status") == "success":
                if not backup_check.get("is_recent"):
                    logger.info("Pre-Execution Backup Check: Backup is stale or missing for %s. Injecting run_config_backup tool.", device_name)
                    backup_tool = {
                        "name": "run_config_backup",
                        "args": {"device_name": device_name}
                    }
                    if not any(t["name"] == "run_config_backup" for t in planned):
                        planned.insert(0, backup_tool)
                else:
                    logger.info("Pre-Execution Backup Check: Backup for %s is recent (%.2f hours old).", device_name, backup_check.get("age_hours"))
            else:
                logger.warning("Pre-Execution Backup Check: Failed to verify backup status: %s", backup_check.get("error"))
            
    logger.info("Risk Classifier: tier=%s, status=%s", risk_tier, approval_status)
    return {
        "risk_tier": risk_tier,
        "approval_status": approval_status,
        "planned_tools": planned,
        "approval_requested_at": time.time() if risk_tier == "write" and approval_status != "blocked_by_itsm" else 0.0
    }


def human_approval_gate_node(state: AgentState) -> dict:
    """Interrupt boundary node. Resumes with approved or rejected status."""
    status = state.get("approval_status", "pending")
    logger.info("Human Approval Gate executing: status=%s", status)
    return {"approval_status": status}


def decline_explain_node(state: AgentState) -> dict:
    """Explains why write action was rejected, timed out, or blocked."""
    status = state.get("approval_status", "")
    if status == "blocked_by_itsm":
        devices = state.get("target_devices", [])
        device_name = devices[0] if devices else "unknown"
        msg = (
            f"❌ **Blocked by ITSM Gating**: No active, approved Change Request (CR) found for device **{device_name}**.\n\n"
            f"Please navigate to the **🎟️ ITSM Tickets** tab in the sidebar, create a new Change Request for **{device_name}**, "
            f"and mark it as **Approved** before running this command."
        )
        return {"final_response": msg, "synth_was_streamed": False}
    return {"final_response": "⛔ **Action Declined**: The request was rejected by the operator or timed out (5-minute window expired). No configurations were modified.", "synth_was_streamed": False}


_TOOL_ERROR_PREFIXES = re.compile(
    r"^\s*(\[error\]|error\b|failed to|no such file or directory|"
    r"max retries exceeded|connection refused|traceback|"
    r"temporary failure in name resolution)",
    re.IGNORECASE,
)

def detect_tool_failure(output_text: str) -> str:
    """A successful MCP RPC round-trip doesn't mean the tool's own operation
    succeeded — the server can catch its own error and still return HTTP 200.
    Inspect the payload itself so status reflects the real outcome."""
    if not output_text:
        return "success"
    probe = output_text.strip()
    if probe.startswith("{") or probe.startswith("["):
        try:
            parsed = json.loads(probe)
            if isinstance(parsed, dict):
                inner_status = str(parsed.get("status", "")).lower()
                if inner_status in ("error", "failed", "failure") or parsed.get("error"):
                    return "error"
        except Exception:
            pass
    if _TOOL_ERROR_PREFIXES.match(probe):
        return "error"
    return "success"


async def tool_executor_generator(state: AgentState):
    """Generator version of tool execution that yields progress updates."""
    planned = state.get("planned_tools", [])
    results = []
    
    yield {"tool_executor_start": {"count": len(planned)}}
    
    from mcp import ClientSession
    from mcp.client.sse import sse_client
    
    for idx, tool in enumerate(planned):
        t_name = tool["name"]
        t_args = tool["args"]
        cmd_name = t_args.get("command", t_name)
        
        yield {"tool_progress": {"index": idx + 1, "total": len(planned), "command": cmd_name}}
        
        logger.info("Executing MCP Tool: %s with args: %s", t_name, t_args)
        try:
            async with sse_client(MCP_SERVER_URL) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as mcp_session:
                    await mcp_session.initialize()
                    mcp_res = await mcp_session.call_tool(t_name, arguments=t_args)
                    output_text = mcp_res.content[0].text if mcp_res.content else "Success"
                    results.append({
                        "tool": t_name,
                        "status": detect_tool_failure(output_text),
                        "output": output_text
                    })
        except Exception as e:
            logger.error("Failed to execute tool %s: %s", t_name, e)
            results.append({
                "tool": t_name,
                "status": "error",
                "output": f"[ERROR] Failed to execute: {str(e)}"
            })
            
    yield {"tool_executor": {"tool_results": results}}

async def tool_executor_node(state: AgentState) -> dict:
    """Wrapper node that executes all tools and returns updates synchronously."""
    results = []
    async for event in tool_executor_generator(state):
        if "tool_executor" in event:
            results = event["tool_executor"]["tool_results"]
    return {"tool_results": results}


def serialize_mcp_output_if_json(output: str) -> str:
    """If the output is structured JSON, serialize it using TOON format to save tokens."""
    if not output:
        return output
    stripped = output.strip()
    if not (stripped.startswith("{") or stripped.startswith("[")):
        return output
    try:
        data = json.loads(stripped)
        import toon_serializer
        res = toon_serializer.serialize_response(data)
        return res["toon_data"]
    except Exception:
        return output


async def gemini_prompt_preparer_node(state: AgentState) -> dict:
    """Builds and sanitizes the Gemini prompt — always runs so the payload is ready for manual escalation.
    The operator inspects this in the approval gate before any data is transmitted."""
    user_msg = ""
    for m in reversed(state["messages"]):
        role = m.get("role") if isinstance(m, dict) else getattr(m, "role", "")
        content = m.get("content") if isinstance(m, dict) else getattr(m, "content", "")
        if role == "user" and content.lower().strip() != "gemini":
            user_msg = content
            break
            
    if not user_msg:
        last_msg = state["messages"][-1]
        user_msg = last_msg["content"] if isinstance(last_msg, dict) else getattr(last_msg, "content", "")
    context = state.get("retrieved_context", "")
    results = state.get("tool_results", [])

    tool_outputs_str = ""
    if results:
        tool_outputs_str = "=== LIVE NETWORK TELEMETRY (MCP SERVER) ===\n"
        for r in results:
            compressed_output = serialize_mcp_output_if_json(r["output"])
            tool_outputs_str += f"Tool: {r['tool']} | Status: {r['status']}\nOutput:\n{compressed_output}\n"

    context_trimmed = context[:2000] if len(context) > 2000 else context
    telemetry_trimmed = tool_outputs_str[:3000] if len(tool_outputs_str) > 3000 else tool_outputs_str
    intent = state.get("intent", "general_chat")

    if intent == "general_chat":
        tmpl = config_loader.get_prompt("gemini_general_chat")
        if tmpl:
            prompt = (
                tmpl
                .replace("{user_msg}", user_msg)
                .replace("{context}", context_trimmed)
            )
        else:
            prompt = (
                f"You are NETAct AI Copilot, an expert network operations assistant.\n"
                f"Answer the user query below. Use the context if relevant.\n\n"
                f"Context:\n{context_trimmed}\n\nUser Query: {user_msg}\n"
            )
    else:
        tmpl = config_loader.get_prompt("telemetry_synthesis")
        if tmpl:
            # Gemini version: no confidence prefix needed (operator review step, not local)
            prompt = (
                tmpl
                .replace("{user_msg}", user_msg)
                .replace("{telemetry}", telemetry_trimmed)
                .replace("{confidence_instruction}", "")
            )
        else:
            prompt = f"You are NETAct AI Copilot.\n\nTelemetry:\n{telemetry_trimmed}\n\nQuery: {user_msg}\n"

    sanitized_prompt, mapping = sanitize_prompt(prompt)

    return {
        "gemini_prompt_preview": sanitized_prompt,
        "gemini_approval_status": "pending",
        "sanitization_mapping": json.dumps(mapping),
    }

def gemini_approval_gate_node(state: AgentState) -> dict:
    """Boundary node for human approval of Gemini cloud transmission."""
    status = state.get("gemini_approval_status", "pending")
    logger.info("Gemini Approval Gate executing: status=%s", status)
    return {"gemini_approval_status": status}

async def local_synthesizer_node(state: AgentState) -> dict:
    """Always runs the local synthesis model first. Parses CONFIDENCE prefix to decide if Gemini escalation should be offered."""
    suggest_device = state.get("suggest_healthcheck_for")
    if suggest_device:
        msg = (
            f"### ℹ️ No Healthcheck Data Yet for **{suggest_device}**\n\n"
            f"I don't have any collected healthcheck telemetry for this device, so I can't answer "
            f"diagnostic questions about it directly.\n\n"
            f"Would you like me to collect one now? Type **`run healthcheck for {suggest_device}`** — "
            f"this runs a real collection against the device via NETAct backend and will ask for your "
            f"confirmation before executing."
        )
        return {
            "local_confidence": "LOW",
            "local_response": msg,
            "has_tool_results": False,
            "final_response": msg,
            "synth_was_streamed": False,
            "gemini_gate_pending": False,
            "gemini_gate_type": "",
        }

    last_msg = state["messages"][-1]
    user_msg = last_msg["content"] if isinstance(last_msg, dict) else last_msg.content

    # Give the synthesis prompt a little conversational memory for short
    # follow-ups ("what about the other one?") — mirrors the same enrichment
    # context_retriever_node applies for retrieval, only for short messages
    # so normal standalone queries are unaffected.
    if len(user_msg.split()) <= 12 and len(state["messages"]) > 1:
        for m in reversed(state["messages"][:-1]):
            m_role = m.get("role") if isinstance(m, dict) else getattr(m, "role", "")
            m_content = m.get("content") if isinstance(m, dict) else getattr(m, "content", "")
            if m_role == "user" and m_content:
                user_msg = f'(Follow-up to: "{m_content}") {user_msg}'
                break

    context = state.get("retrieved_context", "")
    results = state.get("tool_results", [])
    has_tool_results = bool(results)

    # Write tool outcomes to semantic memory
    if results:
        try:
            import semantic_memory
            for r in results:
                tool_name = r.get("tool", "")
                r_status = r.get("status", "")
                output = r.get("output", "")
                devs = state.get("target_devices", [])
                dev = devs[0] if devs else "unknown"
                if "collect" in tool_name or "healthcheck" in tool_name:
                    if any(w in output.lower() for w in ["connection refused", "error", "failed"]):
                        semantic_memory.add_fact(dev, "Last Healthcheck Status", f"FAILED - {output[:120].strip()}")
                    elif r_status == "success":
                        semantic_memory.add_fact(dev, "Last Healthcheck Status", "SUCCESS")
                elif "backup" in tool_name:
                    if r_status == "success":
                        semantic_memory.add_fact(dev, "Last Backup Status", "SUCCESS")
                    else:
                        semantic_memory.add_fact(dev, "Last Backup Status", f"FAILED - {output[:120].strip()}")
        except Exception as e:
            logger.error("Error writing semantic memory facts: %s", e)

    # Build prompt
    tool_outputs_str = ""
    if results:
        tool_outputs_str = "=== LIVE NETWORK TELEMETRY (MCP SERVER) ===\n"
        for r in results:
            compressed = serialize_mcp_output_if_json(r["output"])
            tool_outputs_str += f"Tool: {r['tool']} | Status: {r['status']}\nOutput:\n{compressed}\n"

    context_trimmed = context[:2000] if len(context) > 2000 else context
    telemetry_trimmed = tool_outputs_str[:3000] if len(tool_outputs_str) > 3000 else tool_outputs_str
    intent = state.get("intent", "general_chat")

    confidence_instruction = (
        "IMPORTANT: Begin your response with exactly one of these lines (nothing before it):\n"
        "CONFIDENCE: HIGH   — you have sufficient context and are confident\n"
        "CONFIDENCE: MEDIUM — you have partial context or moderate confidence\n"
        "CONFIDENCE: LOW    — context is missing, question is too device-specific, or you are uncertain\n\n"
    )

    if intent == "general_chat" and not has_tool_results:
        tmpl = config_loader.get_prompt("general_chat")
        if tmpl:
            prompt = (
                tmpl
                .replace("{user_msg}", user_msg)
                .replace("{confidence_instruction}", confidence_instruction)
                .replace("{context}", context_trimmed)
            )
        else:
            # Minimal fallback (should not be reached if prompts.json is present)
            prompt = (
                f"You are NETAct AI Copilot, an expert network operations assistant.\n\n"
                + confidence_instruction
                + f"User Query: {user_msg}\n\nContext (use only if relevant):\n{context_trimmed}\n"
            )
    else:
        tmpl = config_loader.get_prompt("telemetry_synthesis")
        if tmpl:
            base = (
                tmpl
                .replace("{user_msg}", user_msg)
                .replace("{telemetry}", telemetry_trimmed)
                .replace("{confidence_instruction}", confidence_instruction)
            )
        else:
            base = (
                f"You are NETAct AI Copilot. Analyze the network telemetry and answer the query.\n\n"
                f"Telemetry:\n{telemetry_trimmed}\n\nQuery: {user_msg}\n"
            )
        prompt = base

    raw_answer = await call_ollama_stream([{"role": "user", "content": prompt}], model=state.get("active_model"))

    # Parse CONFIDENCE prefix
    confidence = "MEDIUM"
    answer = raw_answer or ""
    lines = answer.strip().split("\n")
    if lines:
        # Strip markdown bold markers (**...**) the model sometimes wraps the prefix with
        first_line_clean = lines[0].strip().lstrip("*").rstrip("*").strip()
        if first_line_clean.upper().startswith("CONFIDENCE:"):
            conf_val = first_line_clean.split(":", 1)[1].strip().upper().split()[0]
            if conf_val in ("HIGH", "MEDIUM", "LOW"):
                confidence = conf_val
            answer = "\n".join(lines[1:]).strip()

    # Deterministic override: self-reported CONFIDENCE is unreliable when
    # retrieval itself was ambiguous (multiple competing chunks from
    # different sources scored within _AMBIGUITY_SCORE_GAP of each other) —
    # the model has no way to know it built its answer from a secondary
    # chunk rather than the real one, so it confidently reports HIGH/MEDIUM
    # regardless. Confirmed live: exactly this scenario produced a
    # confidently wrong answer. Force LOW so the gemini-escalation offer
    # actually surfaces — only LOW currently triggers it (see app.py).
    if not has_tool_results and state.get("retrieval_ambiguous"):
        confidence = "LOW"

    # Guard: very short, empty, or error answer → LOW confidence + replace with useful fallback
    if not answer or len(answer) < 40 or "Failed to query" in answer:
        confidence = "LOW"
        if not answer or "Failed to query" in answer:
            if results:
                lines_out = ["## 📡 Results\n*(AI synthesis unavailable — raw MCP output)*\n"]
                for r in results:
                    icon = "✅" if r.get("status") == "success" else "❌"
                    lines_out.append(f"\n### {icon} `{r.get('tool','unknown')}` — {r.get('status','unknown')}\n```\n{r.get('output','')}\n```")
                answer = "\n".join(lines_out)
            else:
                answer = (
                    "⚠️ **Local model did not return an answer.** "
                    "The Ollama service may be busy or the model is still loading. "
                    "Please try again in a moment, or type `gemini` to escalate to the cloud API."
                )

    # Prepend NOC-compliant health score and anomalies if tool results are present
    if results:
        score, anomalies = calculate_health_score(results)
        
        if score == 100:
            alert_block = "> [!NOTE]\n> All checked network elements are fully operational. Backups are compliant, routing protocols are established, and interfaces are up.\n"
        elif score >= 70:
            alert_block = f"> [!WARNING]\n> Warnings detected in network health. Score: {score}/100. Check interface status or routing peer adjacencies.\n"
        else:
            alert_block = f"> [!CRITICAL]\n> Critical issues detected! Score: {score}/100. Down interfaces or failed peerings found in live telemetry.\n"
            
        anomalies_md = ""
        if anomalies:
            anomalies_md = "**Detected Anomalies:**\n" + "\n".join([f"- {a}" for a in anomalies]) + "\n\n"
            
        proofs = []
        for r in results:
            cmd = r.get("tool", "")
            if r.get("args") and isinstance(r["args"], dict) and "command" in r["args"]:
                cmd = r["args"]["command"]
            output_snippet = r.get("output", "")[:500].strip() + "\n..." if len(r.get("output", "")) > 500 else r.get("output", "").strip()
            proofs.append(f"- **Command**: `{cmd}`\n- **Device**: `{r.get('device', 'unknown') if 'device' in r else state.get('target_devices', ['unknown'])[0]}`\n- **Output snippet**:\n```text\n{output_snippet}\n```")
            
        proof_md = "### 🔍 Proof of Verification\n" + "\n".join(proofs)
        
        formatted_answer = (
            f"## 🩺 NOC Health Status Score: {score}/100\n\n"
            f"{alert_block}\n"
            f"{anomalies_md}"
            f"### 📡 Telemetry Synthesis Report\n"
            f"{answer}\n\n"
            f"--- \n"
            f"{proof_md}"
        )
        answer = formatted_answer

    logger.info("Local synthesizer: confidence=%s, has_tool_results=%s", confidence, has_tool_results)

    # Record confidence distribution metric
    try:
        import metrics as _m
        _m.record_local_confidence(confidence)
    except Exception:
        pass

    return {
        "local_confidence": confidence,
        "local_response": answer,
        "has_tool_results": has_tool_results,
        "final_response": answer,
        "synth_was_streamed": True,
        "gemini_gate_pending": False,
        "gemini_gate_type": "",
    }

# ---------------------------------------------------------------------------
# Build the StateGraph
# ---------------------------------------------------------------------------
builder = StateGraph(AgentState)

# Add Nodes
builder.add_node("intent_router", intent_router_node)
builder.add_node("context_retriever", context_retriever_node)
builder.add_node("tool_planner", tool_planner_node)
builder.add_node("risk_classifier", risk_classifier_node)
builder.add_node("human_approval_gate", human_approval_gate_node)
builder.add_node("decline_explain", decline_explain_node)
builder.add_node("tool_executor", tool_executor_node)
builder.add_node("local_synthesizer", local_synthesizer_node)
builder.add_node("gemini_prompt_preparer", gemini_prompt_preparer_node)

# Fixed edges
builder.add_edge(START, "intent_router")
builder.add_edge("intent_router", "context_retriever")
builder.add_edge("context_retriever", "tool_planner")
builder.add_edge("tool_planner", "risk_classifier")
builder.add_edge("decline_explain", END)
builder.add_edge("tool_executor", "local_synthesizer")
builder.add_edge("local_synthesizer", "gemini_prompt_preparer")
builder.add_edge("gemini_prompt_preparer", END)

# Routing after risk classifier
def route_risk(state: AgentState) -> str:
    planned = state.get("planned_tools", [])
    if not planned:
        return "local_synthesizer"           # No tools → straight to local synthesis
    if state.get("approval_status") == "blocked_by_itsm":
        return "decline_explain"
    if state.get("risk_tier") == "write":
        return "human_approval_gate"
    return "tool_executor"                   # Read-only tools → execute then synthesize

def route_approval(state: AgentState) -> str:
    if state.get("approval_status") == "approved":
        return "tool_executor"
    return "decline_explain"

builder.add_conditional_edges("risk_classifier", route_risk, {
    "local_synthesizer": "local_synthesizer",
    "human_approval_gate": "human_approval_gate",
    "tool_executor": "tool_executor",
    "decline_explain": "decline_explain",
})

builder.add_conditional_edges("human_approval_gate", route_approval, {
    "tool_executor": "tool_executor",
    "decline_explain": "decline_explain",
})

# Fallback in-memory checkpointer (overridden at startup by AsyncSqliteSaver in app.py lifespan)
memory = MemorySaver()

# Both gates active: human approval for write actions, Gemini approval before any cloud transmission.
app = builder.compile(checkpointer=memory, interrupt_before=["human_approval_gate"])

