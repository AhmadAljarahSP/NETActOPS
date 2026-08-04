> [!WARNING] Archived — Original Design Spec
> This note is from the project's original planning phase (`.agents/` in the repo root, migrated 2026-07-19). It describes **intended** architecture and may not match what was actually implemented — e.g. this document set originally specified FAISS + Neo4j for the data layer, but the live system uses Qdrant, and the Neo4j graph-sync path was removed as dead code. Treat this as historical design rationale, not current-state documentation. For what's actually running, see the `Devices/`, `Protocols/`, `Monitoring/` etc. folders (live, auto-generated) or `CLAUDE.md` in the repo root.

---

# NETAct AI Assistant Intent Routing and Sanitization

This skill defines the reference specifications for **Intent Classification, Routing, and Content Sanitization** used across the NETAct system, covering both the **Copilot Backend** and the **Main Automation Backend**. Any future developer or AI agent should use this specification to maintain consistency when extending or debugging the agent's behavior.

---

## 1. Intent Classification & Routing (Copilot)

The intent router determines whether a user query requires **Knowledge Base Retrieval (RAG)** or **Network Telemetry Execution (via MCP tools)**. It operates in `intent_router_node` inside [agent.py](file:///d:/NetAct/copilot/backend/agent.py).

### A. Intent Types
* `run_healthcheck`: Triggers the collection of network diagnostics (saves to Git & updates history).
* `run_backup`: Triggers a configuration backup collection (saves to Git & requires HITL approval).
* `run_diagnostic`: Runs read-only troubleshooting commands (like `ping` or single `show` commands).
* `list_nodes`: Lists the inventory of registered devices.
* `general_chat`: General Q&A (queries the Qdrant Knowledge Base RAG).

### B. Dual-Path Routing Flow
1. **Deterministic Fast-Path (Keyword/Regex)**:
   Performs a regex check to extract IPs or hostnames and checks for key action verbs:
   - *Healthcheck*: `["healthcheck", "health check", "health-check", "collect health", "run health"]`
   - *Backup*: `["backup", "collect backup", "run backup"]`
   - *List Nodes*: `["list node", "list device", "show device", "inventory"]`
   - *Diagnostic*: `["diagnostic", "show ", "display ", "ping ", "traceroute", "run command", "execute"]`
2. **AI-Based Classification (Ollama Fallback)**:
   If keywords do not match deterministically, the query is routed to `qwen2.5-coder:0.5b-instruct` using this system prompt template:
   ```text
   You are an intent router for a network automation system.
   Classify the following query into one of these intents:
   - list_nodes: list all devices/inventory.
   - run_diagnostic: run a show/ping/diagnostic command on a device.
   - run_healthcheck: collect a healthcheck from a device (show version, interfaces, neighbors, etc.).
   - run_backup: trigger configuration backup.
   - run_automation: trigger configuration changes or upgrade.
   - general_chat: general questions, RAG lookups, or greetings.

   Query: {user_msg}
   Respond ONLY with a JSON object: {"intent": "run_diagnostic", "devices": ["BORDER-GW-06"]}
   ```

---

## 2. Tool Planning & Gating (`tool_planner_node`)

Once the intent is determined, the agent maps the intent to MCP tool invocations:

* **Healthcheck**: Plans `run_healthcheck_collect` tool.
* **Backup**: Plans `run_config_backup` tool (Flagged as `write` risk tier, requiring operator confirmation).
* **Diagnostic**: Plans `run_device_diagnostic` tool with raw command arguments.
* **General Chat**: Plans **zero tools**, routing the query directly to Qdrant RAG.

---

## 3. Content & Credential Sanitization Specifications

NETAct implements three distinct layers of sanitization to protect user credentials, router privacy, and CLI configuration files:

### A. Copilot LLM Privacy Sanitization (IP Masking)
To ensure compliance with corporate privacy regulations, IP addresses can be masked before sending data to external/public models. The original implementation is found in [app.py](file:///d:/NetAct/copilot/backend/app.py):

* **IP Sanitization Function**:
  ```python
  import re

  def sanitize_content(text: str) -> tuple[str, dict]:
      """Replaces real IP addresses with generic tokens for secure analysis."""
      ip_pattern = r"\b(?:\d{1,3}\.){3}\d{1,3}\b"
      ips = re.findall(ip_pattern, text)
      
      mapping = {}
      sanitized_text = text
      
      for i, ip in enumerate(list(set(ips))):
          token = f"IP_ADDR_{i+1}"
          mapping[token] = ip
          sanitized_text = sanitized_text.replace(ip, token)
          
      return sanitized_text, mapping
  ```

* **IP Restore Function**:
  ```python
  def restore_content(text: str, mapping: dict) -> str:
      """Restores real IPs from generic tokens."""
      restored_text = text
      for token, real_val in mapping.items():
          restored_text = restored_text.replace(token, real_val)
      return restored_text
  ```

### B. Device Credentials Filtering (REST API Gate)
In the main backend ([backend/app.py](file:///d:/NetAct/backend/app.py)), device credential properties (`username`, `password`, and nested `jump_server` passwords) are stripped before sending the data model over public REST APIs or writing to frontend dashboards:

```python
def sanitize_device(device: dict) -> dict:
    """Removes sensitive credentials from device dict objects before returning them to client/UI."""
    sanitized = device.copy()
    sanitized.pop("username", None)
    sanitized.pop("password", None)
    if "jump_server" in sanitized:
        js = sanitized["jump_server"].copy()
        js.pop("username", None)
        js.pop("password", None)
        sanitized["jump_server"] = js
    return sanitized
```

### C. CLI Output & Configuration Log Scrubbing (Sensitive Key Truncation)
In the collection engine ([backend/collector.py](file:///d:/NetAct/backend/collector.py)), raw CLI dumps (e.g. running configurations or healthcheck outputs) are processed line-by-line using regular expressions to truncate sensitive secrets (passwords, root authentication hashes, SNMP community public_community) with `<truncated>` before committing them to the Git repository or displaying them:

```python
def truncate_sensitive_line(line: str) -> str:
    """Detect and truncate sensitive data on a single line of configuration/output."""
    # 1. set system login user
    m = re.search(r"^(.*?\bset\s+system\s+login\s+user\s+\S+\s+authentication\s+(?:plaintext-password|encrypted-password)\s+)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 2. set system root-authentication
    m = re.search(r"^(.*?\bset\s+system\s+root-authentication\s+(?:plaintext-password|encrypted-password)\s+)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 3. set snmp community
    public_community = re.search(r"^(.*?\bset\s+snmp\s+community\s+)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 4. snmp-server community
    public_community = re.search(r"^(.*?\bsnmp-server\s+community\s+(?:cipher\s+|simple\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 5. snmp-agent community
    public_community = re.search(r"^(.*?\bsnmp-agent\s+community\s+(?:read\s+|write\s+)?(?:cipher\s+|simple\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 6. local-user passwords
    m = re.search(r"^(.*?\blocal-user\s+\S+.*?\b(?:password|cipher)\s+(?:cipher\s+|simple\s+|encrypted\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 7. username (with password demo_password secret)
    m = re.search(r"^(.*?\busername\s+\S+.*?\b(?:password|secret)\s+(?:cipher\s+|simple\s+|encrypted\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 8. SNMP traps version community public_community
    m = re.search(r"^(.*?\btraps\s+version\s+2c\s+(?:cipher\s+|simple\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 9. General password demo_password
    m = re.search(r"^(.*?\b(?:password|secret)\s+(?:cipher\s+|simple\s+|encrypted\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    return line

def sanitize_output(text: str) -> str:
    """Process configuration text line-by-line to truncate sensitive values."""
    if not text:
        return text
    return "\n".join(truncate_sensitive_line(line) for line in text.splitlines())
```
