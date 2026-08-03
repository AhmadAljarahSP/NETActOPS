import os
import sys
import re
import glob
import json
import subprocess

def load_env_key():
    key = os.getenv("ENCRYPTION_KEY")
    if key:
        return key
    script_dir = os.path.dirname(os.path.abspath(__file__))
    env_path = os.path.join(script_dir, ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("ENCRYPTION_KEY="):
                    return line.split("=", 1)[1].strip()
    return None

# Check if we are running inside the container
inside_container = os.path.exists("/git/repo/healthchecks")

if inside_container:
    # ---------------------------------------------------------
    # Inside container: perform OSPF neighbor extraction
    # ---------------------------------------------------------
    # Add backend path to sys.path to import devices
    sys.path.append("/app")
    try:
        from app import check_and_reload_devices_if_needed, devices
        check_and_reload_devices_if_needed()
    except Exception as import_err:
        devices = {}

    from cryptography.fernet import Fernet

    key = os.getenv("ENCRYPTION_KEY")
    if not key:
        print(json.dumps({"error": "ENCRYPTION_KEY environment variable not set inside container"}))
        sys.exit(1)

    fernet = Fernet(key.encode())
    healthchecks_dir = "/git/repo/healthchecks"

    def clean_name(name):
        if not name:
            return None
        return name.replace("-re0", "")

    def find_hostname(ip_or_id):
        if not ip_or_id:
            return None
        for dev in devices.values():
            if dev.get("ip_address") == ip_or_id or dev.get("hostname") == ip_or_id:
                return clean_name(dev.get("hostname"))
        return None

    def extract_blocks(text):
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

    files = glob.glob(os.path.join(healthchecks_dir, "**", "*.txt"), recursive=True)
    device_files = {}
    for f_path in files:
        parts = f_path.split("/")
        if len(parts) >= 3:
            device_name = parts[-2]
            device_files.setdefault(device_name, []).append(f_path)

    latest_files = []
    for dev, paths in device_files.items():
        paths.sort()
        latest_files.append(paths[-1])

    targets = []
    seen = set() # Avoid duplicates: (source, target_ip)

    for f_path in latest_files:
        device_name = f_path.split("/")[-2]
        source_name = clean_name(device_name)
        
        try:
            with open(f_path, "rb") as f:
                raw = f.read()
            decrypted = fernet.decrypt(raw).decode('utf-8', errors='ignore')
            blocks = extract_blocks(decrypted)
            
            # 1. Huawei display ospf peer
            huawei_cmd = next((c for c in blocks if c.strip() == "display ospf peer"), None)
            if huawei_cmd:
                out = blocks[huawei_cmd]
                pattern = re.compile(r'Router ID:\s*([0-9.]+)\s+Address:\s*([0-9.]+).*\r?\n\s*State:\s*([a-zA-Z]+)', re.MULTILINE)
                matches = pattern.findall(out)
                for router_id, address, state in matches:
                    if state.lower() in ["full", "twoway"]:
                        key_tuple = (source_name, address)
                        if key_tuple not in seen:
                            seen.add(key_tuple)
                            targets.append({
                                "source": source_name,
                                "target_ip": address,
                                "success_rate": 100.0,
                                "rtt_min": 0.0,
                                "rtt_avg": 150.0,
                                "rtt_max": 250.0,
                                "destination_router": find_hostname(router_id)
                            })
                continue

            # 2. Juniper show ospf neighbor
            juniper_cmd = next((c for c in blocks if "show ospf neighbor" in c.lower()), None)
            if juniper_cmd:
                out = blocks[juniper_cmd]
                for line in out.splitlines():
                    parts = line.split()
                    if len(parts) >= 4:
                        if re.match(r'^[0-9.]+$', parts[0]) and parts[2].lower() in ["full", "twoway"]:
                            address = parts[0]
                            router_id = parts[3]
                            key_tuple = (source_name, address)
                            if key_tuple not in seen:
                                seen.add(key_tuple)
                                targets.append({
                                    "source": source_name,
                                    "target_ip": address,
                                    "success_rate": 100.0,
                                    "rtt_min": 0.0,
                                    "rtt_avg": 150.0,
                                    "rtt_max": 250.0,
                                    "destination_router": find_hostname(router_id)
                                })
                continue

            # 3. Cisco show ospf neighbour
            cisco_cmd = next((c for c in blocks if "show ospf neigh" in c.lower()), None)
            if cisco_cmd:
                out = blocks[cisco_cmd]
                for line in out.splitlines():
                    parts = line.split()
                    if len(parts) >= 6:
                        if re.match(r'^[0-9.]+$', parts[0]) and re.match(r'^[0-9.]+$', parts[4]):
                            state = parts[2].split('/')[0]
                            if state.lower() in ["full", "twoway"]:
                                address = parts[4]
                                router_id = parts[0]
                                key_tuple = (source_name, address)
                                if key_tuple not in seen:
                                    seen.add(key_tuple)
                                    targets.append({
                                        "source": source_name,
                                        "target_ip": address,
                                        "success_rate": 100.0,
                                        "rtt_min": 0.0,
                                        "rtt_avg": 150.0,
                                        "rtt_max": 250.0,
                                        "destination_router": find_hostname(router_id)
                                    })
                continue
        except Exception as e:
            pass

    print(json.dumps(targets, indent=2))

else:
    # ---------------------------------------------------------
    # Host: copy self to container, execute, and write results
    # ---------------------------------------------------------
    print("Running on host. Preparing OSPF neighbor extraction inside Docker...")
    
    key = load_env_key()
    if not key:
        print("Error: ENCRYPTION_KEY not found in environment or .env file.")
        sys.exit(1)

    script_path = os.path.abspath(__file__)
    container_script_path = "/tmp/collect_ospf_neighbors.py"
    
    # 1. Copy script to container
    print("Copying script to NETAct_backend container...")
    cp_res = subprocess.run(["docker", "cp", script_path, "NETAct_backend:" + container_script_path], capture_output=True)
    if cp_res.returncode != 0:
        print(f"Error copying script: {cp_res.stderr.decode()}")
        sys.exit(1)

    # 2. Run script inside container
    print("Executing script inside container...")
    exec_res = subprocess.run([
        "docker", "exec", "-e", f"ENCRYPTION_KEY={key}", "NETAct_backend",
        "python", container_script_path
    ], capture_output=True, text=True)

    if exec_res.returncode != 0:
        print(f"Execution failed: {exec_res.stderr}")
        sys.exit(1)

    # 3. Save output
    output_text = exec_res.stdout.strip()
    try:
        targets_data = json.loads(output_text)
        
        # Write results to local folder
        local_dir = os.path.dirname(script_path)
        output_file = os.path.join(local_dir, "isp_ping_targets_bypythonscript.json")
        
        with open(output_file, "w", encoding="utf-8") as out_f:
            json.dump(targets_data, out_f, indent=2)
            
        print(f"\nSuccess! Extracted {len(targets_data)} OSPF neighbor targets.")
        print(f"Results saved to: {output_file}")
    except json.JSONDecodeError:
        print("Error: Failed to parse JSON output from container.")
        print("Raw output received:")
        print(output_text[:1000])
        sys.exit(1)
