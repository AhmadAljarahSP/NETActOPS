#!/usr/bin/env python3
import telnetlib
import time
import os
import subprocess
from datetime import datetime

# EVE-NG Cisco IOS Devices
DEVICES = [
    {"hostname": "R1", "port": 32769},
    {"hostname": "R2", "port": 32770},
    {"hostname": "R3", "port": 32771},
    {"hostname": "R4", "port": 32772},
    {"hostname": "R5", "port": 32773},
    {"hostname": "R6", "port": 32774},
    {"hostname": "R7", "port": 32775},
    {"hostname": "R8", "port": 32776},
    {"hostname": "R9", "port": 32777},
    {"hostname": "R10", "port": 32778},
    {"hostname": "sw11", "port": 32779},
    {"hostname": "sw12", "port": 32780},
    {"hostname": "sw13", "port": 32781},
    {"hostname": "sw14", "port": 32782},
    {"hostname": "R15", "port": 32783},
]

TARGET_IP = "10.10.10.10"
COMMANDS = [
    "terminal length 0",
    "show version",
    "show ip interface brief",
    "show ip ospf neighbor",
    "show lldp neighbors"
]

REPO_PATH = "/git/repo"
HEALTHCHECKS_DIR = os.path.join(REPO_PATH, "healthchecks")

def execute_command(tn, cmd):
    """Write command and read until prompt is found or timeout."""
    tn.write(cmd.encode('ascii') + b"\n")
    time.sleep(0.5)
    output = ""
    end_time = time.time() + 10.0  # 10s max per command
    while time.time() < end_time:
        chunk = tn.read_very_eager().decode('ascii', errors='ignore')
        if chunk:
            output += chunk
            stripped = output.strip()
            # Cisco prompt ends with > or #
            if stripped.endswith(">") or stripped.endswith("#"):
                break
            end_time = time.time() + 2.0  # Reset timeout on data receipt
        else:
            time.sleep(0.1)
    return output

def collect_from_device(hostname, port):
    print(f"Connecting to {hostname} ({TARGET_IP}:{port})...")
    try:
        tn = telnetlib.Telnet(TARGET_IP, port, timeout=10)
        time.sleep(1)
        
        # Wait for initial prompt after connection
        initial = ""
        end_time = time.time() + 5.0
        while time.time() < end_time:
            chunk = tn.read_very_eager().decode('ascii', errors='ignore')
            if chunk:
                initial += chunk
                stripped = initial.strip()
                if stripped.endswith(">") or stripped.endswith("#"):
                    break
            else:
                time.sleep(0.1)
        
        parts = [
            f"=== Device: {hostname} ===",
            f"=== IP: {TARGET_IP} ===",
            f"=== Type: HEALTHCHECK ===",
            f"=== Protocol: TELNET ===",
            f"=== Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ===\n"
        ]
        
        for cmd in COMMANDS:
            print(f"  Executing: {cmd}")
            output = execute_command(tn, cmd)
            parts.extend([
                "=" * 60,
                f">>> {cmd}",
                "=" * 60,
                output,
                ""
            ])
            
        tn.write(b"exit\n")
        tn.close()
        return "\n".join(parts)
        
    except Exception as e:
        err_msg = f"[ERROR] Failed to collect from {hostname}: {str(e)}"
        print(f"  {err_msg}")
        return err_msg

def commit_to_git(filepath, hostname):
    try:
        subprocess.run(["git", "add", filepath], cwd=REPO_PATH, check=True)
        # Check if there are changes staged
        diff_res = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPO_PATH)
        if diff_res.returncode != 0:
            msg = f"Auto-sync: EVE-NG healthcheck update for {hostname}"
            subprocess.run(["git", "commit", "-m", msg], cwd=REPO_PATH, check=True)
            print(f"  Successfully committed changes for {hostname}")
        else:
            print(f"  No changes detected for {hostname}")
    except Exception as e:
        print(f"  Git commit failed for {hostname}: {e}")

def main():
    if not os.path.exists(HEALTHCHECKS_DIR):
        print(f"Creating directory: {HEALTHCHECKS_DIR}")
        os.makedirs(HEALTHCHECKS_DIR, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    for dev in DEVICES:
        hostname = dev["hostname"]
        port = dev["port"]
        
        # Collect telemetry
        telemetry = collect_from_device(hostname, port)
        
        # Save output
        dev_dir = os.path.join(HEALTHCHECKS_DIR, hostname)
        os.makedirs(dev_dir, exist_ok=True)
        filename = f"healthcheck_{timestamp}.txt"
        filepath = os.path.join(dev_dir, filename)
        
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(telemetry)
            
        print(f"  Saved to {filepath}")
        
        # Commit to local git repository
        commit_to_git(filepath, hostname)

if __name__ == "__main__":
    main()
