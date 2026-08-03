import os
import sys
import json
import time
import re
import asyncio
import logging
try:
    import requests as _requests
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    def _http_get(url, headers=None, timeout=10):
        resp = _requests.get(url, headers=headers or {}, verify=False, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    def _http_post(url, json_data=None, headers=None, timeout=10):
        resp = _requests.post(url, json=json_data, headers=headers or {}, verify=False, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
except ImportError:
    import urllib.request as _urllib_req
    import json as _json
    def _http_get(url, headers=None, timeout=10):
        req = _urllib_req.Request(url, headers=headers or {})
        with _urllib_req.urlopen(req, timeout=timeout) as r:
            return _json.loads(r.read().decode())
    def _http_post(url, json_data=None, headers=None, timeout=10):
        data = _json.dumps(json_data or {}).encode()
        req = _urllib_req.Request(url, data=data, headers={**(headers or {}), "Content-Type": "application/json"})
        with _urllib_req.urlopen(req, timeout=timeout) as r:
            return _json.loads(r.read().decode())
import difflib
from datetime import datetime, timedelta
from mcp.server.fastmcp import FastMCP

# Try importing Genie and TTP parsers for structured CLI outputs
try:
    from genie.conf.base import Device as GenieDevice
    from genie.libs.parser.utils import get_parser as get_genie_parser
    logging.getLogger("mcp_server").info("Successfully imported Genie parser components.")
except ImportError as e:
    logging.getLogger("mcp_server").warning("Genie import failed (Cisco parsing will fall back to raw): %s", e)
    GenieDevice = None
    get_genie_parser = None

try:
    from ttp import ttp
    from huawei_templates import HUAWEI_TEMPLATES
    logging.getLogger("mcp_server").info("Successfully imported TTP and Huawei templates.")
except ImportError as e:
    logging.getLogger("mcp_server").warning("TTP or Huawei templates import failed: %s", e)
    ttp = None
    HUAWEI_TEMPLATES = {}


# Setup logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    force=True
)
logger = logging.getLogger("mcp_server")

# Try to find and import backend modules
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_backend = os.path.abspath(os.path.join(current_dir, "..", "backend"))
container_backend = "/backend"

if os.path.exists(container_backend):
    sys.path.append(container_backend)
    logger.info("Using container backend path: %s", container_backend)
elif os.path.exists(parent_backend):
    sys.path.append(parent_backend)
    logger.info("Using local parent backend path: %s", parent_backend)
else:
    logger.warning("Backend path not found in /backend or %s", parent_backend)

try:
    import asyncssh
    from async_jump_transport import AsyncJumpTransport
    from collector import get_vendor_config, read_until_prompt, clean_output
    logger.info("Successfully imported asyncssh, AsyncJumpTransport, and collector helpers.")
except ImportError as e:
    logger.error("Failed to import backend collector modules: %s. Using basic mocks.", e)
    # We will define fallback mocks if imports fail to avoid crashing the server on start
    class AsyncJumpTransport:
        def __init__(self, *args, **kwargs): pass
        async def ensure_connection(self): raise NotImplementedError("AsyncJumpTransport mock")
        async def close(self): pass
    def get_vendor_config(vendor):
        return {"prompt_pattern": r"[>#%]\s*$", "request_pty": True, "term_type": "vt100", "paging_cmd": "terminal length 0", "quit_cmd": "exit"}
    async def read_until_prompt(stdout, pattern, timeout): return ""
    def clean_output(raw, cmd, pattern): return raw

# Environment configurations
try:
    import dotenv
    dotenv.load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except ImportError:
    pass

JUMP_HOST = os.getenv("JUMP_HOST", "")
JUMP_USER = os.getenv("JUMP_USER")
JUMP_PASS = os.getenv("JUMP_PASSWORD")
DEVICE_USER = os.getenv("DEVICE_USER")
DEVICE_PASS = os.getenv("DEVICE_PASS")

NETACT_BACKEND_URL = os.getenv("NETACT_BACKEND_URL", "http://backend:8000")
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
AUTOMATION_URL = os.getenv("AUTOMATION_URL", "http://automation:8003")
APP_PASSWORD = os.getenv("APP_PASSWORD", "")

# Initialize FastMCP Server
mcp = FastMCP("NetAct-MCP-Server", host="0.0.0.0", port=5001)

def is_tool_enabled(server_id: str, tool_name: str) -> bool:
    import sqlite3
    db_path = os.getenv("DB_PATH", "copilot_history.db")
    
    # Resolve relative db paths
    if not os.path.isabs(db_path):
        db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "db", db_path))
        
    if not os.path.exists(db_path):
        return True
        
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # 1. Check if the entire server is disabled
        cursor.execute("SELECT is_enabled FROM mcp_runtime_state WHERE target_id = ?", (server_id,))
        row = cursor.fetchone()
        if row and not row[0]:
            conn.close()
            return False
            
        # 2. Check if the specific tool is disabled
        target_id = f"{server_id}/{tool_name}"
        cursor.execute("SELECT is_enabled FROM mcp_runtime_state WHERE target_id = ?", (target_id,))
        row = cursor.fetchone()
        conn.close()
        
        if row and not row[0]:
            return False
            
        return True
    except Exception as e:
        logger.error("Error checking tool state in DB: %s", e)
        return True


async def call_external_mcp_tool(server_id: str, tool_name: str, arguments: dict) -> str:
    import json
    config_path = "/app/db/mcp_config.json"
    if not os.path.exists(config_path):
        config_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "db", "mcp_config.json"))
        
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        endpoint = None
        for srv in cfg.get("servers", []):
            if srv["id"] == server_id:
                endpoint = srv["endpoint"]
                break
        if not endpoint:
            return f"Error: Server config for '{server_id}' not found."
    except Exception as e:
        return f"Error loading server configuration: {str(e)}"
        
    from mcp.client.session import ClientSession
    from mcp.client.sse import sse_client
    
    try:
        async with sse_client(endpoint) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                response = await session.call_tool(tool_name, arguments=arguments)
                
                if response.isError:
                    return f"Error executing tool '{tool_name}': {response.content}"
                    
                text_contents = []
                for item in response.content:
                    if hasattr(item, "text"):
                        text_contents.append(item.text)
                    elif isinstance(item, dict) and "text" in item:
                        text_contents.append(item["text"])
                    else:
                        text_contents.append(str(item))
                return "\n".join(text_contents)
    except Exception as e:
        return f"Failed to call external MCP server '{server_id}': {str(e)}"


# Helper function to query backend with x-api-key auth header
def query_backend(endpoint: str, method: str = "GET", payload: dict = None, timeout: int = 10) -> dict:
    url = f"{NETACT_BACKEND_URL.rstrip('/')}/{endpoint.lstrip('/')}"
    headers = {
        "x-api-key": APP_PASSWORD,
        "Content-Type": "application/json"
    }
    try:
        if method.upper() == "POST":
            data = _http_post(url, json_data=payload, headers=headers, timeout=timeout)
            return {"success": True, "data": data}
        else:
            data = _http_get(url, headers=headers, timeout=timeout)
            return {"success": True, "data": data}
    except Exception as e:
        return {"success": False, "error": str(e)}

# Helper to run a command on a router via SSH
async def execute_ssh_command(device: dict, cmd: str) -> str:
    target_ip = device["ip_address"]
    vendor = device.get("vendor", "cisco")
    port = int(device.get("port", 22))
    vcfg = get_vendor_config(vendor)
    
    logger.info("Executing SSH diagnostic: %s on %s (%s)", cmd, device["hostname"], target_ip)
    
    jump_transport = AsyncJumpTransport(JUMP_HOST, JUMP_USER, JUMP_PASS)
    try:
        jump_conn = await jump_transport.ensure_connection()
        device_conn = await asyncssh.connect(
            target_ip,
            port=port,
            username=DEVICE_USER,
            password=DEVICE_PASS,
            known_hosts=None,
            client_keys=[],
            tunnel=jump_conn,
        )
        async with device_conn:
            stdin, stdout, stderr = await device_conn.open_session(
                term_type=vcfg["term_type"],
                request_pty=vcfg["request_pty"],
            )
            # Read banner
            await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=30)
            
            # Disable pagination
            if vcfg["paging_cmd"]:
                stdin.write(f"{vcfg['paging_cmd']}\n")
                await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=15)
            
            # Write diagnostic command
            stdin.write(f"{cmd}\n")
            raw = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=60)
            output = clean_output(raw, cmd, vcfg["prompt_pattern"])
            
            # Graceful logout
            stdin.write(f"{vcfg['quit_cmd']}\n")
            stdin.close()
            return output
            
    except Exception as e:
        logger.error("SSH Command failed for %s: %s", device["hostname"], e, exc_info=True)
        return f"[ERROR] SSH connection failed: {str(e)}"
    finally:
        await jump_transport.close()

# Helper to run a command on a router via Telnet
async def execute_telnet_command(device: dict, cmd: str) -> str:
    target_ip = device["ip_address"]
    vendor = device.get("vendor", "cisco")
    port = int(device.get("port", 23))
    vcfg = get_vendor_config(vendor)
    
    logger.info("Executing Telnet diagnostic: %s on %s (%s)", cmd, device["hostname"], target_ip)
    
    jump_transport = AsyncJumpTransport(JUMP_HOST, JUMP_USER, JUMP_PASS)
    try:
        jump_conn = await jump_transport.ensure_connection()
        stdin, stdout, stderr = await jump_conn.open_session(
            term_type="vt100",
            request_pty=True,
        )
        await asyncio.sleep(1.0)
        
        # Flush initial channel stream
        while True:
            try:
                chunk = await asyncio.wait_for(stdout.read(4096), timeout=0.2)
                if not chunk: break
            except asyncio.TimeoutError:
                break
        
        # Connect to router via Telnet from Jump Host
        stdin.write(f"telnet {target_ip} {port}\n")
        
        login_prompt = r"[Uu]ser(name)?[:\s]|[Ll]ogin[:\s]"
        password_prompt = r"[Pp]ass(word)?[:\s]"
        device_prompt = vcfg["prompt_pattern"]
        
        buf = ""
        deadline = time.time() + 30.0
        phase = "connecting"
        
        while time.time() < deadline:
            try:
                chunk = await asyncio.wait_for(stdout.read(4096), timeout=1.0)
                if not chunk: break
                buf += chunk
            except asyncio.TimeoutError:
                pass
            
            if phase == "connecting" and re.search(login_prompt, buf, re.IGNORECASE):
                stdin.write(f"{DEVICE_USER}\n")
                buf = ""
                phase = "authenticating"
                await asyncio.sleep(1.0)
                continue
            if phase == "authenticating" and re.search(password_prompt, buf, re.IGNORECASE):
                stdin.write(f"{DEVICE_PASS}\n")
                buf = ""
                phase = "post-auth"
                await asyncio.sleep(1.0)
                continue
            if re.search(device_prompt, buf):
                break
                
        await asyncio.sleep(0.5)
        
        # Flush auth responses
        while True:
            try:
                chunk = await asyncio.wait_for(stdout.read(4096), timeout=0.2)
                if not chunk: break
            except asyncio.TimeoutError:
                break
        
        # Disable pagination
        if vcfg["paging_cmd"]:
            stdin.write(f"{vcfg['paging_cmd']}\n")
            await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=15)
            
        # Write command
        stdin.write(f"{cmd}\n")
        raw = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=60)
        output = clean_output(raw, cmd, vcfg["prompt_pattern"])
        
        # Graceful logout
        stdin.write(f"{vcfg['quit_cmd']}\n")
        stdin.close()
        return output
        
    except Exception as e:
        logger.error("Telnet Command failed for %s: %s", device["hostname"], e, exc_info=True)
        return f"[ERROR] Telnet connection failed: {str(e)}"
    finally:
        await jump_transport.close()


# =====================================================================
# Structured Parser Helpers
# =====================================================================

def parse_cli_output(vendor: str, command: str, raw_text: str) -> dict | None:
    """
    Parses raw command output using Genie (for Cisco/Juniper) or TTP (for Huawei).
    Returns a dictionary if parsed successfully, or None.
    """
    v = vendor.lower()
    cmd = command.lower().strip()
    
    # 1. Map NetAct vendor to Genie OS
    genie_os_map = {
        "cisco": "iosxe",
        "cisco_ios": "iosxe",
        "iosxe": "iosxe",
        "cisco_xr": "iosxr",
        "iosxr": "iosxr",
        "nxos": "nxos",
        "juniper": "junos",
        "junos": "junos"
    }
    
    # Check if we should use TTP for Huawei
    if "huawei" in v:
        if not ttp or not HUAWEI_TEMPLATES:
            logger.warning("TTP or Huawei templates not loaded; skipping Huawei parsing.")
            return None
            
        # Match template by command prefix
        matching_cmd = None
        for t_cmd in HUAWEI_TEMPLATES.keys():
            if cmd.startswith(t_cmd):
                matching_cmd = t_cmd
                break
                
        if matching_cmd:
            try:
                template_text = HUAWEI_TEMPLATES[matching_cmd]
                parser = ttp(data=raw_text, template=template_text)
                parser.parse()
                result = parser.result()
                # TTP returns list of lists of dicts usually, flatten it
                if result and isinstance(result, list):
                    flat_result = result[0]
                    if flat_result and isinstance(flat_result, list):
                        flat_result = flat_result[0]
                    return flat_result
            except Exception as e:
                logger.error("Huawei TTP parsing failed for command '%s': %s", command, e)
        return None
        
    # 2. Parse using Genie
    os_name = None
    for k, val in genie_os_map.items():
        if k in v:
            os_name = val
            break
            
    if os_name and GenieDevice and get_genie_parser:
        try:
            # Map common command variations to Genie canonical commands
            canonical_cmd = cmd
            if canonical_cmd.startswith("sh "):
                canonical_cmd = "show " + canonical_cmd[3:]
            elif canonical_cmd.startswith("disp ") or canonical_cmd.startswith("display "):
                if os_name == "junos":
                    canonical_cmd = "show " + re.sub(r'^(display|disp)\s+', '', canonical_cmd)
                    
            dummy_device = GenieDevice("dummy", os=os_name)
            parser = get_genie_parser(canonical_cmd, dummy_device)
            return parser.parse(raw_text)
        except Exception as e:
            logger.debug("Genie parsing skipped/failed for command '%s' on %s: %s", command, os_name, e)
            
    return None


def convert_json_to_markdown_table(command: str, data: dict) -> str:
    """
    Formats parsed JSON data into a clean Markdown table based on command type.
    """
    cmd = command.lower().strip()
    
    # 1. OSPF Neighbor formatting
    if "ospf neighbor" in cmd or "ospf peer" in cmd:
        headers = ["Neighbor ID", "Local Interface", "IP Address", "State"]
        rows = []
        
        # Handle Genie format
        if "interfaces" in data:
            for intf, intf_data in data["interfaces"].items():
                neighbors = intf_data.get("neighbors", {})
                for nbr_id, nbr_details in neighbors.items():
                    rows.append([
                        nbr_id,
                        intf,
                        nbr_details.get("address", "N/A"),
                        nbr_details.get("state", "N/A")
                    ])
        # Handle TTP format
        elif "ospf_neighbors" in data:
            neighbors = data["ospf_neighbors"]
            if isinstance(neighbors, dict):
                neighbors = [neighbors]
            for nbr in neighbors:
                rows.append([
                    nbr.get("neighbor_id", "N/A"),
                    nbr.get("local_interface", "N/A"),
                    nbr.get("neighbor_ip", "N/A") or nbr.get("address", "N/A"),
                    nbr.get("state", "N/A")
                ])
                
        if rows:
            table_lines = [
                "| " + " | ".join(headers) + " |",
                "| " + " | ".join(["---"] * len(headers)) + " |"
            ]
            for r in rows:
                table_lines.append("| " + " | ".join(str(val) for val in r) + " |")
            return "\n".join(table_lines)
            
    # 2. LLDP Neighbors formatting
    if "lldp neighbor" in cmd:
        headers = ["Local Interface", "Neighbor Interface", "Neighbor Device"]
        rows = []
        
        # Handle Genie format
        if "interfaces" in data:
            for intf, intf_data in data["interfaces"].items():
                port_id = intf_data.get("port_id", {})
                for p_id, p_details in port_id.items():
                    rows.append([
                        intf,
                        p_details.get("port_id", "N/A"),
                        p_details.get("device_id", "N/A")
                    ])
        # Handle TTP format
        elif "lldp_neighbors" in data:
            neighbors = data["lldp_neighbors"]
            if isinstance(neighbors, dict):
                neighbors = [neighbors]
            for nbr in neighbors:
                rows.append([
                    nbr.get("local_interface", "N/A"),
                    nbr.get("neighbor_interface", "N/A"),
                    nbr.get("neighbor_device_id", "N/A")
                ])
                
        if rows:
            table_lines = [
                "| " + " | ".join(headers) + " |",
                "| " + " | ".join(["---"] * len(headers)) + " |"
            ]
            for r in rows:
                table_lines.append("| " + " | ".join(str(val) for val in r) + " |")
            return "\n".join(table_lines)
            
    # 3. IP Interface brief formatting
    if "ip interface brief" in cmd or "ip int brief" in cmd:
        headers = ["Interface", "IP Address", "Status", "Protocol"]
        rows = []
        
        # Handle Genie format
        if "interfaces" in data:
            for intf, intf_data in data["interfaces"].items():
                rows.append([
                    intf,
                    intf_data.get("ip_address", "N/A"),
                    intf_data.get("status", "N/A") or intf_data.get("interface_is_up", "N/A"),
                    intf_data.get("protocol", "N/A") or intf_data.get("line_protocol_is_up", "N/A")
                ])
        # Handle TTP format
        elif "interfaces" in data:
            interfaces = data["interfaces"]
            if isinstance(interfaces, dict):
                interfaces = [interfaces]
            for intf in interfaces:
                rows.append([
                    intf.get("interface", "N/A"),
                    intf.get("ip_address", "N/A"),
                    intf.get("physical", "N/A"),
                    intf.get("protocol", "N/A")
                ])
                
        if rows:
            table_lines = [
                "| " + " | ".join(headers) + " |",
                "| " + " | ".join(["---"] * len(headers)) + " |"
            ]
            for r in rows:
                table_lines.append("| " + " | ".join(str(val) for val in r) + " |")
            return "\n".join(table_lines)

    # 4. Fallback Dict to MD table converter (if data can be flattened)
    flat_list = []
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, list):
                flat_list.extend(v)
            elif isinstance(v, dict):
                flat_list.append(v)
    elif isinstance(data, list):
        flat_list = data
        
    if flat_list and isinstance(flat_list[0], dict):
        keys = list(flat_list[0].keys())
        headers = [k.replace("_", " ").title() for k in keys]
        table_lines = [
            "| " + " | ".join(headers) + " |",
            "| " + " | ".join(["---"] * len(headers)) + " |"
        ]
        for item in flat_list:
            if isinstance(item, dict):
                row = [str(item.get(k, "N/A")) for k in keys]
                table_lines.append("| " + " | ".join(row) + " |")
        return "\n".join(table_lines)
        
    return json.dumps(data, indent=2)


# =====================================================================
# MCP Server Tools
# =====================================================================

@mcp.tool()
def list_devices() -> str:
    """
    Retrieves the complete list of devices currently monitored by the NetAct database.
    Returns: A JSON string containing device hostname, IP address, vendor, and group.
    """
    res = query_backend("/devices")
    if not res["success"]:
        return f"Error fetching devices: {res['error']}"
    
    device_list = res["data"]
    output = []
    for d in device_list:
        output.append({
            "id": d.get("id"),
            "hostname": d.get("hostname"),
            "ip_address": d.get("ip_address"),
            "vendor": d.get("vendor"),
            "group": d.get("group_file"),
            "protocol": d.get("protocol", "ssh")
        })
    return json.dumps(output, indent=2)


@mcp.tool()
async def run_device_diagnostic(device_name: str, command: str, output_format: str = "text") -> str:
    """
    Executes a read-only diagnostic command on a network router or switch.
    Args:
        device_name: The hostname of the device.
        command: The read-only CLI command to run (e.g., 'show ip interface brief', 'show ospf neighbor', 'ping 8.8.8.8').
        output_format: Output formatting. Choices: 'text' (raw CLI), 'json' (structured JSON), 'markdown_table' (Markdown table).
    """
    # 1. Fetch devices list from backend
    res = query_backend("/devices")
    if not res["success"]:
        return f"Error: Cannot connect to NetAct backend to fetch device details: {res['error']}"
    
    device = None
    for d in res["data"]:
        if d.get("hostname", "").lower() == device_name.lower():
            device = d
            break
            
    if not device:
        return f"Error: Device with hostname '{device_name}' was not found in the NetAct inventory."
    
    # 2. Command Safety Check: Block configuration modifications & enforce read-only prefixes
    forbidden = ["conf t", "configure", "commit", "delete", "set", "write", "reload", "reboot", "shutdown", "no shut"]
    lowered_cmd = command.lower().strip()
    if any(f in lowered_cmd for f in forbidden):
        return f"Security Violation: Command '{command}' contains modifying keywords and is blocked on diagnostics."
        
    vendor = device.get("vendor", "cisco").lower()
    
    # Vendor-specific CLI command prefix enforcement & auto-correction
    if "cisco" in vendor or "juniper" in vendor or "junos" in vendor:
        if lowered_cmd.startswith("display "):
            corrected_cmd = "show " + command[8:]
            logger.info("Auto-correcting command for %s vendor: '%s' -> '%s'", vendor, command, corrected_cmd)
            command = corrected_cmd
            lowered_cmd = command.lower().strip()
        elif not lowered_cmd.startswith("show") and not any(lowered_cmd.startswith(p) for p in ["ping", "traceroute", "get", "list"]):
            return f"Security Violation: Command '{command}' on {vendor.upper()} must start with a valid prefix (e.g. 'show', 'ping')."
    elif "huawei" in vendor or "vrp" in vendor:
        if lowered_cmd.startswith("show "):
            corrected_cmd = "display " + command[5:]
            logger.info("Auto-correcting command for %s vendor: '%s' -> '%s'", vendor, command, corrected_cmd)
            command = corrected_cmd
            lowered_cmd = command.lower().strip()
        elif not lowered_cmd.startswith("display") and not any(lowered_cmd.startswith(p) for p in ["ping", "tracert", "get", "list"]):
            return f"Security Violation: Command '{command}' on HUAWEI/VRP must start with a valid prefix (e.g. 'display', 'ping')."
    else:
        allowed_prefixes = ["show", "display", "ping", "traceroute", "get", "list"]
        if not any(lowered_cmd.startswith(p) for p in allowed_prefixes):
            return f"Security Violation: Command '{command}' must start with an allowed diagnostic prefix: {', '.join(allowed_prefixes)}."
    
    # 3. Determine protocol and execute
    protocol = device.get("protocol", "ssh").lower()
    if protocol == "telnet":
        raw_output = await execute_telnet_command(device, command)
    else:
        raw_output = await execute_ssh_command(device, command)
        
    if "[ERROR]" in raw_output:
        return raw_output
        
    # 4. Apply output formatting if requested
    vendor = device.get("vendor", "cisco")
    fmt = output_format.lower().strip()
    
    if fmt == "json":
        parsed = parse_cli_output(vendor, command, raw_output)
        if parsed:
            return json.dumps(parsed, indent=2)
        else:
            return json.dumps({
                "parsed": False,
                "error": "No parser found or parsing failed for this command",
                "raw_output": raw_output
            }, indent=2)
            
    elif fmt == "markdown_table":
        parsed = parse_cli_output(vendor, command, raw_output)
        if parsed:
            return convert_json_to_markdown_table(command, parsed)
        else:
            return f"*Parsing fell back to raw text (no parser found or parsing failed):*\n\n```text\n{raw_output}\n```"
            
    return raw_output



@mcp.tool()
def get_active_alarms() -> str:
    """
    Scans the NetAct network backup and healthcheck dashboard metrics to summarize active issues.
    Returns: A summary of failed backups, failed healthchecks, and configuration drifts.
    """
    # Query stats
    stats_res = query_backend("/dashboard/stats")
    backups_res = query_backend("/devices/backups-summary")
    health_res = query_backend("/devices/healthchecks-summary")
    
    if not stats_res["success"]:
        return f"Error connecting to backend: {stats_res['error']}"
        
    stats = stats_res["data"]
    backups = backups_res["data"] if backups_res["success"] else []
    healthchecks = health_res["data"] if health_res["success"] else []
    
    issues = []
    
    # Check healthcheck failures
    for h in healthchecks:
        h_sum = h.get("healthcheck_summary") or {}
        last_h = h_sum.get("last_healthcheck")
        if last_h and last_h.get("status") == "fail":
            issues.append(f"Diagnostics Failed: {h['hostname']} (IP: {h['ip_address']}) - Error: {last_h.get('error_msg')}")
            
    # Check backup failures & drifts
    for b in backups:
        b_sum = b.get("backup_summary") or {}
        last_b = b_sum.get("last_backup")
        if last_b and last_b.get("status") == "fail":
            issues.append(f"Backup Failed: {b['hostname']} (IP: {b['ip_address']}) - Error: {last_b.get('error_msg')}")
        if b_sum.get("is_compliant") is False:
            issues.append(f"Config Drift Detected: {b['hostname']} is out of compliance with the Git repository version.")
            
    # Format report
    total_issues = len(issues)
    report = [
        f"=== NetAct Active Alarms Report ===",
        f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"Total Devices in Inventory: {stats.get('total_devices')}",
        f"Global Backups: Success={stats.get('backup_stats', {}).get('success')}, Failed={stats.get('backup_stats', {}).get('fail')}",
        f"Global Healthchecks: Success={stats.get('backup_stats', {}).get('healthcheck_success')}, Failed={stats.get('backup_stats', {}).get('healthcheck_fail')}",
        f"-----------------------------------",
        f"Active Unresolved Issues ({total_issues}):"
    ]
    
    if total_issues == 0:
        report.append("  - No active alarms or config drifts detected. Everything is healthy.")
    else:
        for issue in issues:
            report.append(f"  [ALERT] {issue}")
            
    return "\n".join(report)


@mcp.tool()
def query_router_metrics(device_name: str, metric_type: str = "cpu", duration_minutes: int = 60) -> str:
    """
    Queries real-time telemetry ranges from the Prometheus instance for a specific device.
    Args:
        device_name: Hostname of the target device.
        metric_type: The metric to query. Choices: 'cpu' (CPU utilization), 'memory' (memory utilization), 'latency' (ping duration), 'status' (health status).
        duration_minutes: The duration in minutes to fetch (default: 60).
    """
    # Map friendly names to Prometheus metric names
    metric_map = {
        "cpu": "netact_device_cpu_utilization",
        "memory": "netact_device_memory_utilization",
        "latency": "netact_device_healthcheck_duration_seconds",
        "status": "netact_healthcheck_status"
    }
    
    prom_metric = metric_map.get(metric_type.lower())
    if not prom_metric:
        return f"Error: Metric type '{metric_type}' is invalid. Choose from: cpu, memory, latency, status."
        
    # Build Prometheus range query
    end_time = time.time()
    start_time = end_time - (duration_minutes * 60)
    
    query = f'{prom_metric}{{device="{device_name}"}}'
    
    url = f"{PROMETHEUS_URL.rstrip('/')}/api/v1/query_range"
    params = {
        "query": query,
        "start": start_time,
        "end": end_time,
        "step": "1m" if duration_minutes <= 120 else "5m"
    }
    
    try:
        import urllib.parse
        full_url = url + "?" + urllib.parse.urlencode(params)
        data = _http_get(full_url, timeout=10)
        results = data.get("data", {}).get("result", [])
        if not results:
            return f"No Prometheus data found for device '{device_name}' with metric '{prom_metric}' in the last {duration_minutes} minutes."
            
        output = [
            f"=== Prometheus Metrics for {device_name} ===",
            f"Metric: {prom_metric}",
            f"Duration: Last {duration_minutes} minutes",
            f"-----------------------------------------",
            f"| Timestamp            | Value           |",
            f"|----------------------|-----------------|"
        ]
        
        # Format the time-series values
        values = results[0].get("values", [])
        # Show a selection of values to avoid flooding context
        step = max(1, len(values) // 15)
        for i in range(0, len(values), step):
            timestamp_sec, val = values[i]
            dt = datetime.fromtimestamp(float(timestamp_sec)).strftime("%Y-%m-%d %H:%M:%S")
            # Round value for clean output
            try:
                formatted_val = f"{float(val):.2f}"
            except ValueError:
                formatted_val = str(val)
            output.append(f"| {dt}  | {formatted_val:<15} |")
            
        return "\n".join(output)
    except Exception as e:
        return f"Prometheus connection error: {str(e)}"


@mcp.tool()
async def audit_config_changes(device_name: str) -> str:
    """
    Compares the router's current running configuration with the latest Git backup configuration.
    Returns: A unified diff string highlighting configuration drifts.
    """
    # 1. Fetch devices list to resolve ID
    res = query_backend("/devices")
    if not res["success"]:
        return f"Error: Cannot connect to NetAct backend: {res['error']}"
        
    device = None
    for d in res["data"]:
        if d.get("hostname", "").lower() == device_name.lower():
            device = d
            break
            
    if not device:
        return f"Error: Device '{device_name}' was not found in the NetAct inventory."
        
    device_id = device["id"]
    
    # 2. Get latest backup version info
    history_res = query_backend(f"/backups/{device_id}/history?limit=1")
    if not history_res["success"] or not history_res["data"]:
        return f"Audit Cancelled: No backup history found for device '{device_name}' in the Git repository."
        
    latest_backup = history_res["data"][0]
    backup_id = latest_backup["id"]
    
    # 3. Fetch backup text
    full_backup_res = query_backend(f"/collections/{backup_id}/full?collection_type=backup&device_id={device_id}")
    if not full_backup_res["success"] or not full_backup_res["data"]:
        return f"Error: Failed to retrieve backup content for run '{backup_id}'."
        
    backup_config_text = full_backup_res["data"].get("config_text", "")
    if not backup_config_text:
        return f"Error: Backup config text for version '{backup_id}' is empty."
        
    # 4. Fetch running configuration
    running_cmd = "display current-configuration" if device.get("vendor", "").lower() == "huawei" else "show running-config"
    running_config_text = await run_device_diagnostic(device_name, running_cmd)
    
    if "[ERROR]" in running_config_text:
        return f"Audit Failed: Could not fetch running configuration: {running_config_text}"
        
    # 5. Compute Unified Diff
    diff = difflib.unified_diff(
        backup_config_text.splitlines(),
        running_config_text.splitlines(),
        fromfile='Git_Backup_Config',
        tofile='Running_Config',
        lineterm=''
    )
    
    diff_text = "\n".join(list(diff))
    if not diff_text.strip():
        return f"Audit Complete: Running configuration for '{device_name}' matches the latest Git backup version exactly."
        
    return f"Configuration mismatch detected for '{device_name}':\n\n{diff_text}"


@mcp.tool()
async def run_config_backup(device_name: str) -> str:
    """
    Triggers a live configuration backup collection for the specified network device.
    Saves the result to the Git repository, commits it, and updates the backup history.
    """
    res = query_backend("/devices")
    if not res["success"]:
        return f"Error: Cannot connect to NetAct backend to fetch device details: {res['error']}"
        
    device = None
    for d in res["data"]:
        if d.get("hostname", "").lower() == device_name.lower():
            device = d
            break
            
    if not device:
        return f"Error: Device '{device_name}' was not found in the NetAct inventory."
        
    device_id = device["id"]
    logger.info("Triggering backup via NetAct backend API for device ID: %d", device_id)
    
    # Trigger the backup POST endpoint on the main backend (with 60-second timeout)
    backup_res = query_backend(f"/backup/{device_id}", method="POST", timeout=60)
    if not backup_res["success"]:
        return f"Error triggering backup: {backup_res['error']}"
        
    status = backup_res["data"].get("status")
    backup_id = backup_res["data"].get("backup_id")
    preview = backup_res["data"].get("output_preview", "")
    
    return (
        f"### 💾 Configuration Backup Result for `{device_name}`\n\n"
        f"- **Status**: `{status.upper() if status else 'UNKNOWN'}`\n"
        f"- **Backup ID / Commit**: `{backup_id}`\n"
        f"- **Action**: Successfully saved and committed to the Git repository backups directory.\n\n"
        f"**Output Preview**:\n```\n{preview}\n```"
    )


@mcp.tool()
async def run_healthcheck_collect(device_name: str) -> str:
    """
    Runs a complete network healthcheck for the specified network device.
    Saves the collected telemetry results to the Git repository, commits them,
    and updates the Healthcheck history dashboard.
    """
    res = query_backend("/devices")
    if not res["success"]:
        return f"Error: Cannot connect to NetAct backend to fetch device details: {res['error']}"
        
    device = None
    for d in res["data"]:
        if d.get("hostname", "").lower() == device_name.lower():
            device = d
            break
            
    if not device:
        return f"Error: Device '{device_name}' was not found in the NetAct inventory."
        
    device_id = device["id"]
    logger.info("Triggering healthcheck via NetAct backend API for device ID: %d", device_id)
    
    # Trigger the healthcheck POST endpoint on the main backend (with 60-second timeout)
    hc_res = query_backend(f"/healthcheck/{device_id}", method="POST", timeout=60)
    if not hc_res["success"]:
        return f"Error triggering healthcheck: {hc_res['error']}"
        
    status = hc_res["data"].get("status")
    hc_id = hc_res["data"].get("healthcheck_id")
    preview = hc_res["data"].get("output_preview", "")
    
    return (
        f"### 📡 Healthcheck Collection Result for `{device_name}`\n\n"
        f"- **Status**: `{status.upper() if status else 'UNKNOWN'}`\n"
        f"- **Healthcheck ID / Commit**: `{hc_id}`\n"
        f"- **Action**: Successfully saved and committed to the Git repository healthchecks directory.\n\n"
        f"**Output Preview**:\n```\n{preview}\n```"
    )


@mcp.tool()
async def run_automation_flow(flow_name: str) -> str:
    """
    Triggers a visual ReactFlow automation workflow/template by name.
    Args:
        flow_name: The name of the automation flow (e.g. 'IPTV', 'UpgradeOSPF').
    """
    headers = {
        "x-api-key": APP_PASSWORD,
        "Content-Type": "application/json"
    }
    
    # 1. Fetch available flows from the automation container
    url_flows = f"{AUTOMATION_URL.rstrip('/')}/flows"
    logger.info("Fetching flows list from %s", url_flows)
    try:
        data = _http_get(url_flows, headers=headers, timeout=10)
    except Exception as e:
        return f"Error: Cannot connect to automation engine: {str(e)}"
        
    flow = None
    for f in data:
        if f.get("name", "").lower() == flow_name.lower() or f.get("id", "").lower() == flow_name.lower():
            flow = f
            break
            
    if not flow:
        available = [f.get("name") for f in data]
        return f"Error: Automation flow '{flow_name}' was not found. Available flows: {', '.join(available)}"
        
    # 2. Trigger the flow run
    url_run = f"{AUTOMATION_URL.rstrip('/')}/run-flow"
    payload = {
        "name": flow["name"],
        "nodes": flow["nodes"],
        "edges": flow["edges"]
    }
    
    logger.info("Triggering flow run: %s via %s", flow["name"], url_run)
    try:
        res = _http_post(url_run, json_data=payload, headers=headers, timeout=15)
        task_id = res.get("task_id")
        return (
            f"### 🚀 IPTV Automation Flow Triggered\n\n"
            f"- **Flow Name**: `{flow['name']}`\n"
            f"- **Task ID**: `{task_id}`\n"
            f"- **Status**: `QUEUED / RUNNING`\n\n"
            f"The visual ReactFlow automation pipeline has been successfully triggered in the background on the automation engine."
        )
    except Exception as e:
        return f"Error triggering automation flow: {str(e)}"


@mcp.tool()
async def batfish_upload_snapshot(snapshot_name: str, configs: dict) -> str:
    """
    Uploads device configurations to Batfish and initializes a snapshot.
    Args:
        snapshot_name: Name of the snapshot.
        configs: Dictionary mapping device hostnames to configuration content.
    """
    if not is_tool_enabled("batfish", "batfish_upload_snapshot"):
        return "Error: Batfish snapshot upload is disabled by security policy."
        
    def _run():
        import tempfile
        import shutil
        from pybatfish.client.session import Session
        
        # Connect to Batfish
        batfish_host = os.getenv("BATFISH_HOST", "batfish")
        batfish_port = int(os.getenv("BATFISH_PORT", "9996"))
        bf = Session(host=batfish_host, port=batfish_port)
        bf.set_network("netact")
        
        snap_dir = tempfile.mkdtemp(prefix="batfish_snap_")
        configs_dir = os.path.join(snap_dir, "configs")
        os.makedirs(configs_dir, exist_ok=True)
        
        try:
            for device_name, config_content in configs.items():
                safe_name = "".join(c if c.isalnum() or c in "-_." else "_" for c in device_name)
                filepath = os.path.join(configs_dir, safe_name)
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(config_content)
                    
            bf.init_snapshot(snap_dir, name=snapshot_name, overwrite=True)
            
            # List devices discovered
            node_props = bf.q.nodeProperties().answer().frame()
            devices = node_props["Node"].tolist() if not node_props.empty else []
            
            return {
                "snapshot_name": snapshot_name,
                "status": "CREATED",
                "device_count": len(devices),
                "devices": devices
            }
        finally:
            shutil.rmtree(snap_dir, ignore_errors=True)
            
    try:
        res = await asyncio.to_thread(_run)
        return json.dumps(res, indent=2)
    except Exception as e:
        return json.dumps({"status": "ERROR", "error": str(e)}, indent=2)


@mcp.tool()
async def batfish_validate_config(snapshot_name: str) -> str:
    """
    Validates configuration syntax for device configs uploaded in a snapshot.
    Returns: A JSON report of pass/fail status per device.
    """
    if not is_tool_enabled("batfish", "batfish_validate_config"):
        return "Error: Batfish config validation is disabled by security policy."
        
    def _run():
        from pybatfish.client.session import Session
        batfish_host = os.getenv("BATFISH_HOST", "batfish")
        batfish_port = int(os.getenv("BATFISH_PORT", "9996"))
        bf = Session(host=batfish_host, port=batfish_port)
        bf.set_network("netact")
        bf.set_snapshot(snapshot_name)
        
        # Query file parse status & node properties
        parse_status = bf.q.fileParseStatus().answer().frame()
        node_props = bf.q.nodeProperties().answer().frame()
        
        device_results = []
        overall_pass = True
        
        for _, row in parse_status.iterrows():
            file_name = str(row.get("File_Name", ""))
            status_val = str(row.get("Status", "UNKNOWN"))
            nodes = row.get("Nodes", [])
            
            if status_val in ("PASSED", "PARTIALLY_UNRECOGNIZED"):
                dev_status = "PASS" if status_val == "PASSED" else "PARTIALLY_PARSED"
            else:
                dev_status = "FAIL"
                overall_pass = False
                
            vendor = "UNKNOWN"
            device_name = ""
            if nodes and len(nodes) > 0:
                device_name = str(nodes[0]) if not isinstance(nodes, str) else nodes
                node_row = node_props[node_props["Node"] == device_name]
                if not node_row.empty:
                    vendor = str(node_row.iloc[0].get("Configuration_Format", "UNKNOWN"))
                    
            warnings = []
            errors = []
            if status_val == "PARTIALLY_UNRECOGNIZED":
                warnings.append("Some configuration lines were not recognized by the parser")
            if status_val == "FAILED":
                errors.append(f"Configuration file could not be parsed: {file_name}")
                
            device_results.append({
                "device_name": device_name or file_name,
                "status": dev_status,
                "file_name": file_name,
                "parse_warnings": warnings,
                "errors": errors,
                "vendor": vendor
            })
            
        global_warnings = []
        init_issues = bf.q.initIssues().answer().frame()
        if not init_issues.empty:
            for _, issue_row in init_issues.iterrows():
                issue_text = str(issue_row.get("Issue", ""))
                if issue_text:
                    global_warnings.append(issue_text)
                    
        return {
            "snapshot_name": snapshot_name,
            "overall_status": "PASS" if overall_pass else "FAIL",
            "device_results": device_results,
            "warnings": global_warnings
        }
        
    try:
        res = await asyncio.to_thread(_run)
        return json.dumps(res, indent=2)
    except Exception as e:
        return json.dumps({"status": "ERROR", "error": str(e)}, indent=2)


# ---------------------------------------------------------------------------
# Cisco pyATS MCP Proxy Tools
# ---------------------------------------------------------------------------

@mcp.tool()
async def pyATS_run_show_command(device_name: str, command: str) -> str:
    """
    Executes a standard show command on a Cisco IOS/NX-OS device using Cisco pyATS/Genie 
    and returns the structured JSON or parsed output.
    """
    if not is_tool_enabled("mcpyats", "pyATS_run_show_command"):
        return "Error: Cisco pyATS show command execution is disabled by security policy."
        
    return await call_external_mcp_tool("mcpyats", "pyATS_run_show_command", {
        "device_name": device_name,
        "command": command
    })


@mcp.tool()
async def pyATS_configure_device(device_name: str, commands: str) -> str:
    """
    Applies configuration commands to a Cisco network device using Cisco pyATS.
    Note: Requires explicit operator approval in production environments.
    """
    if not is_tool_enabled("mcpyats", "pyATS_configure_device"):
        return "Error: Cisco pyATS device configuration changes are disabled by security policy."
        
    return await call_external_mcp_tool("mcpyats", "pyATS_configure_device", {
        "device_name": device_name,
        "commands": commands
    })


@mcp.tool()
async def pyATS_show_running_config(device_name: str) -> str:
    """
    Retrieves the running configuration from a Cisco device using Cisco pyATS.
    """
    if not is_tool_enabled("mcpyats", "pyATS_show_running_config"):
        return "Error: Cisco pyATS running config retrieval is disabled by security policy."
        
    return await call_external_mcp_tool("mcpyats", "pyATS_show_running_config", {
        "device_name": device_name
    })


@mcp.tool()
async def learn_config(device_name: str, feature: str) -> str:
    """
    Learns Cisco device state/features (e.g. interface, OSPF, BGP, routing) using pyATS.
    """
    if not is_tool_enabled("mcpyats", "learn_config"):
        return "Error: Cisco pyATS state learning is disabled by security policy."
        
    return await call_external_mcp_tool("mcpyats", "learn_config", {
        "device_name": device_name,
        "feature": feature
    })


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "sse":
        # Run as an SSE server (perfect for container daemon)
        logger.info("Starting NetAct MCP Server via SSE transport on port 5001")
        mcp.run(transport="sse")
    else:
        # Run as a Stdin/Stdout server (perfect for command line AI runner)
        logger.info("Starting NetAct MCP Server via StdIO transport")
        mcp.run(transport="stdio")
