import os
import re
import time
import json
import logging
import asyncio
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("isp_pinger")

# Add current path to sys.path to import modules from backend
sys.path.append(os.path.dirname(__file__))

from app import check_and_reload_devices_if_needed, devices, DEVICE_CREDENTIALS
from collector import collect_from_device
from async_jump_transport import AsyncJumpTransport

def extract_command_blocks_local(text: str) -> dict:
    blocks = {}
    current_cmd = None
    buf = []
    separator = re.compile(r'^={3,}')
    cmd_header = re.compile(r'^>>> (.+)$')

    for line in text.splitlines():
        if separator.match(line):
            if current_cmd and buf:
                blocks[current_cmd] = "\n".join(buf)
            if current_cmd:
                buf = []
            continue
        m = cmd_header.match(line)
        if m:
            current_cmd = m.group(1).strip()
            buf = []
        elif current_cmd is not None:
            buf.append(line)

    if current_cmd and buf:
        blocks[current_cmd] = "\n".join(buf)

    return blocks

def parse_ping_output(output_text: str) -> dict:
    success_rate = 0.0
    rtt_min = 0.0
    rtt_avg = 0.0
    rtt_max = 0.0
    
    cisco_match = re.search(r'Success rate is (\d+) percent', output_text, re.IGNORECASE)
    if cisco_match:
        success_rate = float(cisco_match.group(1))
    else:
        loss_match = re.search(r'([\d.]+)\s*%\s*packet loss', output_text, re.IGNORECASE)
        if loss_match:
            success_rate = 100.0 - float(loss_match.group(1))
        else:
            replies = len(re.findall(r'Reply from|bytes from', output_text, re.IGNORECASE))
            if replies > 0:
                success_rate = min(100.0, (replies / 5.0) * 100.0)
                
    rtt_match = re.search(r'round-trip min/avg/max(?:/stddev)?\s*=\s*([0-9.]+)/([0-9.]+)/([0-9.]+)', output_text, re.IGNORECASE)
    if rtt_match:
        rtt_min = float(rtt_match.group(1))
        rtt_avg = float(rtt_match.group(2))
        rtt_max = float(rtt_match.group(3))
        
    return {
        "success_rate": success_rate,
        "rtt_min": rtt_min,
        "rtt_avg": rtt_avg,
        "rtt_max": rtt_max
    }

async def run_pings():
    logger.info("Starting ISP Link Pings script")
    check_and_reload_devices_if_needed()
    
    git_dir = os.environ.get("GIT_REPO_PATH", "/git/repo")
    targets_file = os.path.join(git_dir, "isp_ping_targets.json")
    
    if not os.path.exists(targets_file):
        # Not a failure — ISP ping monitoring is opt-in and simply hasn't been
        # configured (no targets saved via POST /isp-ping/targets yet).
        logger.info(f"Targets file {targets_file} does not exist. Nothing to ping.")
        return
        
    try:
        with open(targets_file, "r", encoding="utf-8") as f:
            targets = json.load(f)
    except Exception as e:
        logger.error(f"Failed to read targets: {e}")
        return
        
    if not targets:
        logger.info("No targets defined in isp_ping_targets.json")
        return

    # Group targets by source device
    device_to_targets = {}
    for idx, t in enumerate(targets):
        src = t.get("source")
        target_ip = t.get("target_ip")
        if not src or not target_ip:
            continue
            
        # Resolve device ID from name
        dev_id = None
        for d_id, d in devices.items():
            if d["hostname"] == src or d_id == src:
                dev_id = d_id
                break
                
        if dev_id:
            if dev_id not in device_to_targets:
                device_to_targets[dev_id] = []
            device_to_targets[dev_id].append((idx, target_ip))

    if not device_to_targets:
        logger.info("No active devices matched the targets list source names")
        return

    # Create jump_pool connection transport
    JUMP_HOST = os.getenv("JUMP_HOST", "")
    JUMP_USER = os.getenv("JUMP_USER", "")
    JUMP_PASS = os.getenv("JUMP_PASSWORD", "")
    
    jump_pool = AsyncJumpTransport(host=JUMP_HOST, username=JUMP_USER, password=JUMP_PASS)
    try:
        await jump_pool.ensure_connection()
        logger.info("Connection to jump server established successfully")
    except Exception as e:
        logger.error(f"Failed to connect to jump server: {e}")
        return

    async def ping_device_targets(dev_id, targets_info):
        dev = devices[dev_id]
        vendor = dev.get("vendor", "cisco").lower()
        ping_cmd_template = "ping {} count 5" if ("juniper" in vendor or "junos" in vendor) else "ping {}"
        
        custom_cmds = [ping_cmd_template.format(ip) for _, ip in targets_info]
        
        device_with_creds = {
            **dev,
            "username": DEVICE_CREDENTIALS.get("username", ""),
            "password": DEVICE_CREDENTIALS.get("password", ""),
            "custom_commands": custom_cmds
        }
        
        try:
            logger.info(f"Pinging {len(targets_info)} targets from {dev['hostname']}")
            res = await collect_from_device(jump_pool, device_with_creds, command_type="healthcheck")
            output_text = res.get("output", "")
            
            error_tags = ("[JUMP ERROR]", "[JUMP CONNECT FAIL]", "[ERROR]", "[TIMEOUT]", "[AUTH FAIL]")
            if any(output_text.startswith(tag) for tag in error_tags) or not output_text:
                logger.warning(f"Failed to collect ping results for {dev['hostname']}: {output_text[:100]}")
                return []

            blocks = extract_command_blocks_local(output_text)
            
            device_results = []
            for cmd, cmd_out in blocks.items():
                m_ip = re.search(r'ping\s+(\d+\.\d+\.\d+\.\d+)', cmd, re.IGNORECASE)
                if m_ip:
                    target_ip = m_ip.group(1)
                    metrics = parse_ping_output(cmd_out)
                    
                    # Find original target index
                    original_idx = None
                    for idx, ip in targets_info:
                        if ip == target_ip:
                            original_idx = idx
                            break
                            
                    if original_idx is not None:
                        device_results.append((original_idx, metrics))
            return device_results
        except Exception as e:
            logger.error(f"Error pinging targets on {dev['hostname']}: {e}", exc_info=True)
            return []

    tasks = [ping_device_targets(d_id, t_info) for d_id, t_info in device_to_targets.items()]
    all_results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Update the targets list with actual results
    updated_count = 0
    for res in all_results:
        if isinstance(res, list):
            for original_idx, metrics in res:
                targets[original_idx]["success_rate"] = metrics["success_rate"]
                targets[original_idx]["rtt_min"] = metrics["rtt_min"]
                targets[original_idx]["rtt_avg"] = metrics["rtt_avg"]
                targets[original_idx]["rtt_max"] = metrics["rtt_max"]
                updated_count += 1
                
    # Close jump_pool connection
    await jump_pool.close()
    
    if updated_count > 0:
        try:
            with open(targets_file, "w", encoding="utf-8") as f:
                json.dump(targets, f, indent=2)
            logger.info(f"Updated {updated_count} targets in {targets_file}")
            
            # Git commit changes
            import subprocess
            subprocess.run(["git", "config", "user.name", "Config Backup System"], cwd=git_dir, capture_output=True)
            subprocess.run(["git", "config", "user.email", "backup-system@local"], cwd=git_dir, capture_output=True)
            subprocess.run(["git", "add", "isp_ping_targets.json"], cwd=git_dir, capture_output=True)
            res = subprocess.run(["git", "commit", "-m", "Auto-commit: Updated ISP ping metrics from script"], cwd=git_dir, capture_output=True, text=True)
            logger.info(f"Git commit: {res.stdout.strip()}")
        except Exception as e:
            logger.error(f"Failed to save targets after ping: {e}")
    else:
        logger.info("No targets updated with new ping results")

if __name__ == "__main__":
    asyncio.run(run_pings())
