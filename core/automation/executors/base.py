import os
import re
import sys
import time
import json
import asyncio
import httpx
import logging
import asyncssh
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

logger = logging.getLogger("automation.executors")

# Environmental Variables
JUMP_HOST = os.getenv("JUMP_HOST", "")
JUMP_USER = os.getenv("JUMP_USER", "")
JUMP_PASS = os.getenv("JUMP_PASSWORD", "")
DEVICE_USER = os.getenv("DEVICE_USER", "")
DEVICE_PASS = os.getenv("DEVICE_PASS", "")

# Ensure parent and backend directories are in sys.path
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

# Try shared imports
try:
    from async_jump_transport import AsyncJumpTransport
    from collector import collect_from_device, get_vendor_config, read_until_prompt, clean_output
    from git_manager import GitConfigManager, CollectionType
    logger.info("Shared modules imported successfully inside base.py")
except ImportError as e:
    logger.error("Could not import shared modules in base.py: %s. Using mocks.", e)
    class AsyncJumpTransport:
        def __init__(self, *args, **kwargs): pass
        async def ensure_connection(self): pass
        async def close(self): pass
    class CollectionType:
        BACKUP = "backups"
        HEALTHCHECK = "healthchecks"
    class GitConfigManager:
        def __init__(self, *args, **kwargs):
            self.backups_path = "/git/repo/backups"
            self.healthchecks_path = "/git/repo/healthchecks"
        def save_config(self, *args, **kwargs): return {"id": "mock"}
        def get_device_collections(self, *args, **kwargs): return []
        def get_full_config(self, *args, **kwargs): return None
        def compare_configs(self, *args, **kwargs): return {"diff": "mock_diff"}

class ExecutionContext:
    def __init__(
        self,
        task_id: str,
        flow_name: str,
        nodes: List[dict],
        edges: List[dict],
        devices: dict,
        jump_pool,
        git_manager,
        log_step,
        update_node_run_status,
        step_results: dict,
        pre_healthcheck_ids: dict,
        post_healthcheck_ids: dict,
        failures: list
    ):
        self.task_id = task_id
        self.flow_name = flow_name
        self.nodes = nodes
        self.edges = edges
        self.devices = devices
        self.jump_pool = jump_pool
        self.git_manager = git_manager
        self.log_step = log_step
        self.update_node_run_status = update_node_run_status
        self.step_results = step_results
        self.pre_healthcheck_ids = pre_healthcheck_ids
        self.post_healthcheck_ids = post_healthcheck_ids
        self.failures = failures

def find_upstream_device_select_node(node_id: str, nodes: list, edges: list) -> Optional[dict]:
    if not node_id or not nodes or not edges:
        return None
    incoming_edges = [e for e in edges if e.get("target") == node_id]
    for edge in incoming_edges:
        source_id = edge.get("source")
        source_node = next((n for n in nodes if n.get("id") == source_id), None)
        if not source_node:
            continue
        if source_node.get("type") == "deviceSelectNode":
            return source_node
        found = find_upstream_device_select_node(source_id, nodes, edges)
        if found:
            return found
    return None

def resolve_devices_for_node(node_id: str, nodes: list, edges: list, devices: dict):
    node = next((n for n in nodes if n.get("id") == node_id), None)
    if node and node.get("type") == "deviceSelectNode":
        dev_node = node
    else:
        dev_node = find_upstream_device_select_node(node_id, nodes, edges)
        if not dev_node:
            dev_node = next((n for n in nodes if n.get("type") == "deviceSelectNode"), None)
            
    targeted_devices = []
    custom_creds = None
    
    if dev_node:
        d_data = dev_node.get("data") or {}
        ticked = d_data.get("tickedDevices") or []
        group = d_data.get("group")
        vendor = d_data.get("vendor")
        
        if ticked:
            ticked_str_set = {str(x) for x in ticked}
            targeted_devices = [
                d for d in devices.values()
                if str(d["id"]) in ticked_str_set or d["hostname"] in ticked
            ]
        elif group:
            targeted_devices = [d for d in devices.values() if d.get("group") == group or d.get("group_file") == group]
        elif vendor:
            targeted_devices = [d for d in devices.values() if d.get("vendor").lower() == vendor.lower()]
        else:
            targeted_devices = list(devices.values())
            
        if d_data.get("customUsername"):
            custom_creds = {
                "username": d_data["customUsername"],
                "password": d_data.get("customPassword", "")
            }
    else:
        targeted_devices = list(devices.values())
        
    return targeted_devices, custom_creds

async def push_config_to_device(jump_transport: AsyncJumpTransport, device: dict, config_text: str, custom_creds: Optional[dict] = None) -> Dict[str, Any]:
    target_ip = device["ip_address"]
    username = DEVICE_USER or device.get("username", "")
    password = DEVICE_PASS or device.get("password", "")
    
    if custom_creds and custom_creds.get("username"):
        username = custom_creds["username"]
        password = custom_creds.get("password", "")

    vendor = device.get("vendor", "cisco").lower()
    port = int(device.get("port", 22))
    protocol = device.get("protocol", "ssh").lower()

    logger.info("push_config START - %s (%s) via %s", device.get("hostname"), target_ip, protocol)
    session_log = []
    t0 = time.time()
    vcfg = get_vendor_config(vendor)
    
    try:
        if protocol == "telnet":
            jump_conn = await jump_transport.ensure_connection()
            stdin, stdout, stderr = await jump_conn.open_session(term_type="vt100", request_pty=True)
            await asyncio.sleep(1.0)
            
            while True:
                try:
                    chunk = await asyncio.wait_for(stdout.read(4096), timeout=0.1)
                    if not chunk: break
                except asyncio.TimeoutError:
                    break
            
            stdin.write(f"telnet {target_ip} {port}\n")
            session_log.append(f"JumpServer$ telnet {target_ip} {port}")
            
            login_prompt = r"[Uu]ser(name)?[:\s]|[Ll]ogin[:\s]"
            password_prompt = r"[Pp]ass(word)?[:\s]"
            device_prompt = vcfg["prompt_pattern"]
            
            buf = ""
            deadline = time.time() + 20.0
            phase = "connecting"
            
            while time.time() < deadline:
                try:
                    chunk = await asyncio.wait_for(stdout.read(4096), timeout=0.5)
                    if not chunk: break
                    buf += chunk
                    session_log.append(chunk)
                except asyncio.TimeoutError:
                    pass
                
                if phase == "connecting" and username and re.search(login_prompt, buf, re.IGNORECASE):
                    stdin.write(f"{username}\n")
                    buf = ""
                    phase = "authenticating"
                    await asyncio.sleep(0.5)
                    continue
                if phase == "authenticating" and password and re.search(password_prompt, buf, re.IGNORECASE):
                    stdin.write(f"{password}\n")
                    buf = ""
                    phase = "post-auth"
                    await asyncio.sleep(0.5)
                    continue
                if re.search(device_prompt, buf):
                    break
            
            if vcfg["paging_cmd"]:
                stdin.write(f"{vcfg['paging_cmd']}\n")
                await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=5)
            
            cfg_enter = "system-view" if "huawei" in vendor else "configure terminal"
            stdin.write(f"{cfg_enter}\n")
            session_log.append(f"\nDevice> {cfg_enter}")
            await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=5)
            
            for line in config_text.splitlines():
                if line.strip() and not line.strip().startswith("#"):
                    stdin.write(f"{line}\n")
                    session_log.append(f"\nDevice(config)> {line}")
                    raw_out = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=10)
                    session_log.append(raw_out)
            
            if "huawei" in vendor.lower():
                cfg_exit = "commit\nreturn"
            elif "xr" in vendor.lower():
                cfg_exit = "commit\nend"
            else:
                cfg_exit = "end\nwrite memory"
            stdin.write(f"{cfg_exit}\n")
            session_log.append(f"\nSaving configs...")
            raw_out = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=10)
            session_log.append(raw_out)
            
            stdin.write(f"exit\n")
            stdin.close()
            
        else: # SSH via asyncssh tunnel
            jump_conn = await jump_transport.ensure_connection()
            device_conn = await asyncssh.connect(
                target_ip,
                port=port,
                username=username,
                password=password,
                known_hosts=None,
                client_keys=[],
                tunnel=jump_conn,
            )
            
            async with device_conn:
                stdin, stdout, stderr = await device_conn.open_session(
                    term_type=vcfg["term_type"],
                    request_pty=vcfg["request_pty"],
                )
                
                banner = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=15)
                session_log.append(banner)
                
                if vcfg["paging_cmd"]:
                    stdin.write(f"{vcfg['paging_cmd']}\n")
                    await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=5)
                
                cfg_enter = "system-view" if "huawei" in vendor else "configure terminal"
                stdin.write(f"{cfg_enter}\n")
                session_log.append(f"\nDevice> {cfg_enter}")
                await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=5)
                
                for line in config_text.splitlines():
                    if line.strip() and not line.strip().startswith("#"):
                        stdin.write(f"{line}\n")
                        session_log.append(f"\nDevice(config)> {line}")
                        raw_out = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=15)
                        session_log.append(raw_out)
                
                if "huawei" in vendor.lower():
                    cfg_exit = "commit\nreturn"
                elif "xr" in vendor.lower():
                    cfg_exit = "commit\nend"
                else:
                    cfg_exit = "end\nwrite memory"
                stdin.write(f"{cfg_exit}\n")
                session_log.append(f"\nSaving configs...")
                raw_out = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=15)
                session_log.append(raw_out)
                
                stdin.write(f"exit\n")
                stdin.close()
        
        elapsed = time.time() - t0
        raw_session = "".join([str(x) for x in session_log])
        return {
            "status": "success",
            "duration": elapsed,
            "session_log": raw_session
        }
    except Exception as e:
        logger.error("Failed pushing configs to %s: %s", target_ip, e, exc_info=True)
        return {
            "status": "failed",
            "duration": time.time() - t0,
            "error": str(e),
            "session_log": "".join([str(x) for x in session_log]) + f"\n\n[PUSH FAIL EXCEPTION]: {repr(e)}"
        }
async def send_teams_notification(webhook_url: str, flow_name: str, task_id: str, status: str, started: str, duration: float, devices_list: list, failures: list):
    try:
        status_text = "🟢 Success" if status == "success" else "🔴 Failed"
        
        # Check if URL target is our custom Notification backend
        if "/notify" in webhook_url or "notification-backend" in webhook_url:
            err_details = ""
            if failures:
                err_details = "\n\nErrors:\n" + "\n".join([f"- {f['device']}: {f['error']}" for f in failures])
                
            payload = {
                "event_type": "automation_flow_run",
                "title": f"Workflow {flow_name} Run Completed",
                "message": f"Workflow **{flow_name}** (Run ID: `{task_id}`) finished with status: **{status_text}**.\n"
                           f"Duration: {duration:.2f} seconds\n"
                           f"Devices Targeted: {', '.join(devices_list)}{err_details}"
            }
        # Check if URL target is Matterbridge directly
        elif "/api/message" in webhook_url or "netact_matterbridge" in webhook_url:
            err_details = ""
            if failures:
                err_details = "\nErrors:\n" + "\n".join([f"- {f['device']}: {f['error']}" for f in failures])
                
            payload = {
                "username": "NETAct Notification",
                "text": f"NETAct Automation Flow: {flow_name}\n"
                        f"Run ID: {task_id}\n"
                        f"Status: {status_text}\n"
                        f"Elapsed Time: {duration:.2f} seconds\n"
                        f"Devices Targeted: {', '.join(devices_list)}{err_details}",
                "gateway": "netact_alerts"
            }
        # Fallback: Teams MessageCard
        else:
            color = "00FF00" if status == "success" else "FF0000"
            title = f"NETAct Automation Flow: {flow_name}"
            summary_msg = f"Workflow **{flow_name}** finished execution with status **{status_text}**."
            
            payload = {
                "@type": "MessageCard",
                "@context": "http://schema.org/extensions",
                "themeColor": color,
                "summary": title,
                "sections": [{
                    "activityTitle": title,
                    "activitySubtitle": f"Run ID: {task_id}",
                    "facts": [
                        {"name": "Status", "value": status_text},
                        {"name": "Triggered At", "value": started},
                        {"name": "Elapsed Time", "value": f"{duration:.2f} seconds"},
                        {"name": "Devices Targeted", "value": ", ".join(devices_list)},
                    ],
                    "text": summary_msg
                }]
            }
            if failures:
                payload["sections"].append({
                    "title": "Failed Components / Errors",
                    "text": "\n".join([f"- **{f['device']}**: {f['error']}" for f in failures])
                })

        async with httpx.AsyncClient() as client:
            res = await client.post(webhook_url, json=payload, timeout=10.0)
            if res.status_code >= 400:
                logger.error("Notification trigger gateway error: %d - %s", res.status_code, res.text)
    except Exception as e:
        logger.error("Failed sending notification: %s", e)
