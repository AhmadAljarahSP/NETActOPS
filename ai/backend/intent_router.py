import os
import re
import glob
import json
import logging
from typing import Optional, AsyncGenerator, List, Dict, Any

logger = logging.getLogger("copilot-intent-router")

def format_nodes_report(devices_list: List[Dict[str, Any]]) -> str:
    """Formats the raw database devices list into a professional Markdown table & summary."""
    report = []
    report.append("⚡ **[Fast-Path] NETAct Registered Nodes Report**\n\n")
    report.append("### 🖥️ REGISTERED NETWORK NODES\n\n")
    
    if not devices_list:
        report.append("No registered network devices found in the database.")
        return "".join(report)
        
    report.append("| Hostname | IP Address | Vendor | Protocol | Port | Group |\n")
    report.append("| :--- | :--- | :--- | :--- | :--- | :--- |\n")
    
    for dev in devices_list:
        hname = dev.get("hostname", "N/A")
        ip = dev.get("ip_address", "N/A")
        vendor = dev.get("vendor", "N/A")
        proto = dev.get("protocol", "N/A")
        port = dev.get("port", "N/A")
        group = dev.get("group", "N/A")
        report.append(f"| {hname} | {ip} | {vendor} | {proto} | {port} | {group} |\n")
        
    report.append(f"\n### 📊 SUMMARY & OBSERVATIONS\n\n")
    report.append(f"* **Total Devices**: {len(devices_list)} nodes registered.\n")
    
    # Compute vendor distribution
    vendors = [d.get("vendor") for d in devices_list if d.get("vendor")]
    vendor_counts = {}
    for v in vendors:
        vendor_counts[v] = vendor_counts.get(v, 0) + 1
    vendor_str = ", ".join([f"**{v}**: {c}" for v, c in vendor_counts.items()])
    report.append(f"* **Vendor Distribution**: {vendor_str or 'N/A'}\n")
    
    return "".join(report)

def format_backups_report(backup_records: List[Dict[str, Any]], total_inventory_count: int = None) -> str:
    """Formats secure Git configuration backups list into a professional Markdown table & summary.

    total_inventory_count, if given, is the total number of registered devices
    (not just ones with a backup file on disk) — without it, a report showing
    "Total Tracked Devices: 1" when only 1 of 257 registered devices has ever
    had a backup attempt reads as if the network only has 1 device.
    """
    report = []
    report.append("⚡ **[Fast-Path] Secure Git Backups Report**\n\n")
    report.append("### 📂 AVAILABLE CONFIGURATION BACKUPS\n\n")

    never_backed_up = (total_inventory_count - len(backup_records)) if total_inventory_count is not None else None

    if not backup_records:
        msg = "No configuration backups found in the Git repository database."
        if total_inventory_count:
            msg += f" ({total_inventory_count} registered devices have never had a backup collected.)"
        report.append(msg)
        return "".join(report)
        
    report.append("| Device Hostname | Latest Backup Date | Status | File Size |\n")
    report.append("| :--- | :--- | :--- | :--- |\n")
    
    success_count = 0
    fail_count = 0
    
    for rec in backup_records:
        status_val = rec.get("status", "Unknown")
        status_icon = "🟢 Success" if status_val == "Success" else "🔴 Failed"
        if status_val == "Success":
            success_count += 1
        else:
            fail_count += 1
            
        size_bytes = rec.get("file_size_bytes", 0)
        size_str = f"{size_bytes / 1024:.2f} KB" if size_bytes >= 1024 else f"{size_bytes} Bytes"
        
        report.append(f"| {rec.get('hostname')} | {rec.get('latest_backup_date')} | {status_icon} | {size_str} |\n")
        
    report.append("\n### 📊 SUMMARY & OBSERVATIONS\n\n")
    if total_inventory_count is not None:
        report.append(f"* **Registered Devices**: {total_inventory_count} total.\n")
        report.append(f"* **Devices With a Backup on File**: {len(backup_records)}\n")
        report.append(f"* **Never Backed Up**: ⚠️ {never_backed_up}\n")
    else:
        report.append(f"* **Total Tracked Devices**: {len(backup_records)} devices.\n")
    report.append(f"* **Successful Backups**: 🟢 {success_count}\n")
    report.append(f"* **Failed Backups**: 🔴 {fail_count}\n")

    if fail_count > 0:
        report.append(f"\n> [!WARNING]\n")
        report.append(f"> There are failed backups. Please inspect the connection details and credentials for the failed nodes.\n")
    if never_backed_up:
        report.append(f"\n> [!NOTE]\n")
        report.append(f"> **{never_backed_up}** registered device(s) have no backup on file at all — run a backup collection to establish a baseline.\n")

    return "".join(report)

def format_healthchecks_report(healthcheck_records: List[Dict[str, Any]], total_inventory_count: int = None) -> str:
    """Formats secure Git healthchecks history into a professional Markdown table & summary.

    total_inventory_count, if given, is the total number of registered devices
    (not just ones with a healthcheck file on disk) — without it, a report
    covering only a handful of devices reads as if that's the whole network.
    """
    report = []
    report.append("⚡ **[Fast-Path] Device Healthcheck Report**\n\n")
    report.append("### 🩺 AVAILABLE HEALTHCHECKS\n\n")

    never_run = (total_inventory_count - len(healthcheck_records)) if total_inventory_count is not None else None

    if not healthcheck_records:
        msg = "No healthcheck records found in the Git repository database."
        if total_inventory_count:
            msg += f" ({total_inventory_count} registered devices have never had a healthcheck collected.)"
        report.append(msg)
        return "".join(report)
        
    report.append("| Device Hostname | Latest Diagnostic Run | Status |\n")
    report.append("| :--- | :--- | :--- |\n")
    
    safe_count = 0
    danger_count = 0
    
    for rec in healthcheck_records:
        status_val = rec.get("status", "Unknown")
        status_icon = "🟢 Safe / OK" if "safe" in status_val.lower() or "ok" in status_val.lower() else "🔴 Danger / Failed"
        if "safe" in status_val.lower() or "ok" in status_val.lower():
            safe_count += 1
        else:
            danger_count += 1
            
        report.append(f"| {rec.get('hostname')} | {rec.get('latest_diagnostic_run')} | {status_icon} |\n")
        
    report.append("\n### 📊 SUMMARY & OBSERVATIONS\n\n")
    if total_inventory_count is not None:
        report.append(f"* **Registered Devices**: {total_inventory_count} total.\n")
        report.append(f"* **Devices With a Healthcheck on File**: {len(healthcheck_records)}\n")
        report.append(f"* **Never Collected**: ⚠️ {never_run}\n")
    else:
        report.append(f"* **Total Tracked Devices**: {len(healthcheck_records)} devices.\n")
    report.append(f"* **Healthy Devices (Safe/OK)**: 🟢 {safe_count}\n")
    report.append(f"* **Unhealthy Devices (Danger/Failed)**: 🔴 {danger_count}\n")

    if danger_count > 0:
        report.append(f"\n> [!CRITICAL]\n")
        report.append(f"> Unhealthy nodes detected in diagnostic runs. Immediate action may be required to prevent operational outages.\n")
    if never_run:
        report.append(f"\n> [!NOTE]\n")
        report.append(f"> **{never_run}** registered device(s) have no healthcheck on file at all — run a healthcheck collection to establish a baseline.\n")

    return "".join(report)

def format_config_comparison(target_device: str, diff_content: str) -> str:
    """Wraps raw config Git diff output and parses change statistics."""
    report = []
    report.append("⚡ **[Fast-Path] Configuration Diff Report**\n\n")
    report.append(f"### 🔍 Configuration Backups Comparison for **{target_device}**\n\n")
    
    if diff_content.startswith("[") or "No changes" in diff_content or "only one backup" in diff_content or "No backups found" in diff_content:
        report.append(diff_content)
        return "".join(report)

    _DIFF_CAP = 10000
    displayed_diff = diff_content[:_DIFF_CAP]
    cap_note = ""
    if len(diff_content) > _DIFF_CAP:
        cap_note = f"\n\n*⚠️ Diff truncated ({len(diff_content):,} chars total) — showing first {_DIFF_CAP:,} chars.*"

    report.append("#### 📋 GIT CONFIGURATION DIFF\n")
    report.append("```diff\n")
    report.append(displayed_diff)
    report.append("\n```\n")
    report.append(cap_note + "\n\n")

    # Calculate simple stats from the diff
    additions = len([line for line in diff_content.splitlines() if line.startswith("+") and not line.startswith("+++")])
    deletions = len([line for line in diff_content.splitlines() if line.startswith("-") and not line.startswith("---")])
    
    report.append("#### 📊 CHANGE STATS\n")
    report.append(f"* **Additions**: 🟢 {additions} lines\n")
    report.append(f"* **Deletions**: 🔴 {deletions} lines\n")
    
    return "".join(report)

def format_live_network_status(topo_text: str) -> str:
    """Wrap live topology summary with a Fast-Path header."""
    report = ["⚡ **[Live] Real-Time Network Status**\n\n"]
    report.append(topo_text.replace("===", "###").replace("Devices :", "**Devices:**").replace("Links   :", "**Links:**"))
    report.append("\n\n> ℹ️ Data retrieved directly from the Topology API — always current, zero lag.")
    return "".join(report)

def format_live_device_status(topo_text: str, device: str) -> str:
    """Wrap live device status with a Fast-Path header."""
    report = [f"⚡ **[Live] Device Status — {device}**\n\n"]
    report.append("```\n")
    report.append(topo_text)
    report.append("```\n")
    report.append("\n> ℹ️ Data retrieved directly from the Topology API — always current, zero lag.")
    return "".join(report)

def format_eoleos_compliance(records: list) -> str:
    """Wrap live EOL/EOS compliance records with a Fast-Path header."""
    if not records:
        return (
            "⚡ **[Live] EOL/EOS Compliance**\n\n"
            "No devices with matched EOL/EOS lifecycle data were found."
        )

    matched = [r for r in records if r.get("matched")]
    expired = [r for r in matched if r.get("is_software_expired") or r.get("is_hardware_expired")]
    warning = [r for r in matched if not (r.get("is_software_expired") or r.get("is_hardware_expired"))
               and (r.get("is_software_warning") or r.get("is_hardware_warning"))]

    report = ["⚡ **[Live] EOL/EOS Compliance Status**\n\n"]
    report.append(
        f"**{len(matched)}** devices matched against lifecycle data · "
        f"🔴 **{len(expired)}** expired · 🟡 **{len(warning)}** approaching EOL/EOS\n\n"
    )

    def table(rows: list, title: str) -> str:
        if not rows:
            return ""
        out = [f"### {title}\n\n"]
        out.append("| Device | Platform | Version | Software EOS | Hardware EOS | Status |\n")
        out.append("| :--- | :--- | :--- | :--- | :--- | :--- |\n")
        for r in rows[:20]:
            out.append(
                f"| {r.get('hostname','N/A')} | {r.get('platform','Unknown')} | "
                f"{r.get('current_version','Unknown')} | {r.get('software_eos','N/A')} | "
                f"{r.get('hardware_eos','N/A')} | {r.get('status','unknown')} |\n"
            )
        if len(rows) > 20:
            out.append(f"\n*...and {len(rows) - 20} more.*\n")
        return "".join(out) + "\n"

    report.append(table(expired, "🔴 Past End of Life / End of Sale"))
    report.append(table(warning, "🟡 Approaching End of Life / End of Sale"))

    if not expired and not warning:
        report.append("🟢 All matched devices are within supported lifecycle windows.\n\n")

    report.append("> ℹ️ Data retrieved directly from the backend EOL/EOS registry — always current, zero LLM involved.")
    return "".join(report)

def format_healthcheck_comparison(target_device: str, diff_content: str) -> str:
    """Wraps raw healthcheck diff and highlights warning/error logs."""
    report = []
    report.append("⚡ **[Fast-Path] Healthcheck Runs Comparison**\n\n")
    report.append(f"### 🔍 Healthcheck Runs Comparison for **{target_device}**\n\n")

    if diff_content.startswith("[") or "No changes" in diff_content or "only one healthcheck" in diff_content or "No healthcheck runs" in diff_content:
        report.append(diff_content)
        return "".join(report)

    # Metrics/anomaly detection run over the FULL diff (accurate counts), but
    # the diff text actually shown is capped — a full-file unified diff for a
    # busy router can run into megabytes, unusable in a chat response.
    _DIFF_CAP = 10000
    displayed_diff = diff_content[:_DIFF_CAP]
    cap_note = ""
    if len(diff_content) > _DIFF_CAP:
        cap_note = f"\n\n*⚠️ Diff truncated ({len(diff_content):,} chars total) — showing first {_DIFF_CAP:,} chars.*"

    report.append("#### 📋 UNIFIED HEALTHCHECK DIFF\n")
    report.append("```diff\n")
    report.append(displayed_diff)
    report.append("\n```\n")
    report.append(cap_note + "\n\n")

    additions = len([line for line in diff_content.splitlines() if line.startswith("+") and not line.startswith("+++")])
    deletions = len([line for line in diff_content.splitlines() if line.startswith("-") and not line.startswith("---")])
    
    report.append("#### 📊 METRICS COMPARISON SUMMARY\n")
    report.append(f"* **Status Additions**: 🟢 {additions} entries\n")
    report.append(f"* **Status Deletions**: 🔴 {deletions} entries\n")
    
    # Highlight new warning or error logs
    errors_added = [line for line in diff_content.splitlines() if line.startswith("+") and ("[error]" in line.lower() or "failed" in line.lower() or "down" in line.lower())]
    if errors_added:
        report.append("\n> [!CAUTION]\n")
        report.append("> **New anomalies or errors detected in the latest run:**\n")
        for err in errors_added[:5]:
            report.append(f"> * `{err[1:].strip()}`\n")
            
    return "".join(report)

async def route_intent_locally(
    intent: str,
    device_str: Optional[str],
    target_device: Optional[str],
    flow_name: Optional[str],
    query_lower: str,
    headers: dict,
    active_model: str,
    history: List[Any] = [],
) -> Optional[AsyncGenerator[str, None]]:
    """
    Checks if the intent can be resolved locally by Python to bypass Ollama prompt generation.
    Returns an async generator of chunks if processed locally, or None to fall back to Ollama.
    """
    # Import locally inside the function to avoid circular imports at module load time
    import app
    import httpx
    
    # -----------------------------------------------------------------------
    # 0. INTENT: Current Date and Time
    # -----------------------------------------------------------------------
    if intent == "current_time":
        async def current_time_generator():
            from datetime import datetime
            now = datetime.now()
            date_str = now.strftime("%A, %B %d, %Y")
            time_str = now.strftime("%I:%M:%S %p")
            timezone_str = now.astimezone().tzname()
            yield f"📅 **Current Date**: {date_str}\n🕒 **Current Time**: {time_str} ({timezone_str})\n"
        return current_time_generator()

    elif intent == "clarify_device":
        async def clarify_device_generator():
            devices_list = []
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    resp = await client.get("http://NETAct_backend:8000/devices", headers=headers)
                    if resp.status_code == 200:
                        devices_list = resp.json()
            except Exception:
                pass
            
            query_clean = query_lower.replace("-", " ").replace("_", " ")
            query_words = [w.strip(".,;:?!'\"()[]{}") for w in query_clean.split()]
            stop_words = {"share", "healthcheck", "healthehck", "for", "show", "get", "view", "last", "latest", "results", "log", "config", "backup", "running", "device", "node", "router", "switch", "the", "me", "active", "alarm", "unresolved"}
            query_device_words = [w for w in query_words if w and w not in stop_words]
            
            candidates = []
            for dev in devices_list:
                hname = dev.get("hostname", "")
                if hname:
                    hname_clean = hname.lower().replace("-", " ").replace("_", " ")
                    hname_words = hname_clean.split()
                    matched_words = sum(1 for w in query_device_words if w in hname_words)
                    if matched_words == len(query_device_words):
                        candidates.append(hname)
                        
            report = ["❓ **Multiple nodes matched your query.** Did you mean one of these?\n\n"]
            for cand in sorted(candidates):
                report.append(f"* `{cand}`\n")
            report.append("\nPlease type the exact name to see the results.")
            yield "".join(report)
        return clarify_device_generator()

    elif intent == "unregistered_ip":
        async def unregistered_ip_generator():
            ip_match = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", query_lower)
            ip_str = ip_match.group(0) if ip_match else "specified IP"
            yield f"🔴 **IP Address Not Found**: The IP address `{ip_str}` is not registered in your network inventory. Please check the address or list registered nodes by typing *'list nodes'*."
        return unregistered_ip_generator()

    elif intent == "unregistered_device":
        async def unregistered_device_generator():
            # Use device_str (raw classification output) rather than target_device
            # — target_device goes through resolve_device()'s history fallback,
            # which could substitute an unrelated real device from earlier in the
            # conversation instead of showing what was actually typed here.
            guessed = device_str or _extract_device(query_lower) or "specified device"
            yield f"🔴 **Device Not Found**: `{guessed}` is not registered in your network inventory. Please check the spelling or list registered nodes by typing *'list nodes'*."
        return unregistered_device_generator()

    # -----------------------------------------------------------------------
    # 1. INTENT: List Nodes
    # -----------------------------------------------------------------------
    elif intent == "list_nodes":
        async def list_nodes_generator():
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get("http://NETAct_backend:8000/devices", headers=headers)
                    if resp.status_code == 200:
                        devices_list = resp.json()
                        report = format_nodes_report(devices_list)
                        yield report
                    else:
                        yield f"🔴 Failed to query registered nodes from backend: HTTP {resp.status_code}"
            except Exception as e:
                logger.error(f"Error querying devices from backend locally: {e}")
                yield f"🔴 Failed to connect to main backend system to list nodes: {str(e)}"
        return list_nodes_generator()

    # -----------------------------------------------------------------------
    # 2. INTENT: List Backups
    # -----------------------------------------------------------------------
    elif intent == "list_backups":
        async def list_backups_generator():
            backups_dir = os.path.join(app.GIT_REPO_PATH, "backups")
            if not os.path.isdir(backups_dir):
                yield "### 📂 Available Configuration Backups\n\nNo backup directories found in the Git repository database."
                return
            
            try:
                from datetime import datetime
                backup_records = []
                dev_dirs = [d for d in sorted(os.listdir(backups_dir)) if os.path.isdir(os.path.join(backups_dir, d))]
                for dev_name in dev_dirs:
                    dev_dir = os.path.join(backups_dir, dev_name)
                    if not os.path.isdir(dev_dir):
                        continue
                    files = sorted(glob.glob(os.path.join(dev_dir, "*.txt")))
                    if files:
                        latest_file = files[-1]
                        fname = os.path.basename(latest_file)
                        date_str = fname.replace("backup_", "").replace(".txt", "")
                        try:
                            dt = datetime.strptime(date_str, "%Y%m%d_%H%M%S")
                            formatted_date = dt.strftime("%Y-%m-%d %H:%M:%S")
                        except Exception:
                            formatted_date = date_str
                        
                        status = "Success"
                        try:
                            with open(latest_file, "r", encoding="utf-8", errors="ignore") as f:
                                content = f.read().strip()
                            if content.startswith("gAAAAA") and app.Fernet and app.ENCRYPTION_KEY:
                                try:
                                    fernet_instance = app.Fernet(app.ENCRYPTION_KEY.encode())
                                    decrypted_bytes = fernet_instance.decrypt(content.encode('utf-8'))
                                    content = decrypted_bytes.decode('utf-8', errors='ignore')
                                except Exception:
                                    pass
                            if "[ERROR]" in content or "failed" in content.lower():
                                status = "Failed"
                        except Exception:
                            pass
                            
                        size = os.path.getsize(latest_file)
                        backup_records.append({
                            "hostname": dev_name,
                            "latest_backup_date": formatted_date,
                            "status": status,
                            "file_size_bytes": size
                        })
                
                report = format_backups_report(backup_records, total_inventory_count=len(dev_dirs))
                yield report
            except Exception as e:
                logger.error(f"Error listing backups locally: {e}")
                yield f"🔴 Failed to compile backup records: {str(e)}"
        return list_backups_generator()

    # -----------------------------------------------------------------------
    # 3. INTENT: List Healthchecks
    # -----------------------------------------------------------------------
    elif intent == "list_healthchecks":
        async def list_healthchecks_generator():
            health_dir = os.path.join(app.GIT_REPO_PATH, "healthchecks")
            if not os.path.isdir(health_dir):
                yield "### 🩺 Available Device Healthchecks\n\nNo healthcheck records found in the Git repository database."
                return
            
            try:
                from datetime import datetime
                import re
                healthcheck_records = {}
                
                # Scan directories first
                dev_dirs = [d for d in sorted(os.listdir(health_dir)) if os.path.isdir(os.path.join(health_dir, d))]
                for dev_name in dev_dirs:
                    dev_dir = os.path.join(health_dir, dev_name)
                    if os.path.isdir(dev_dir):
                        files = sorted(glob.glob(os.path.join(dev_dir, "*.txt")))
                        if files:
                            latest_file = files[-1]
                            fname = os.path.basename(latest_file)
                            date_str = fname.replace("healthcheck_", "").replace(".txt", "")
                            try:
                                dt = datetime.strptime(date_str, "%Y%m%d_%H%M%S")
                                formatted_date = dt.strftime("%Y-%m-%d %H:%M:%S")
                                timestamp = dt.timestamp()
                            except Exception:
                                formatted_date = date_str
                                timestamp = 0.0
                            
                            status = "Safe / OK"
                            try:
                                with open(latest_file, "r", encoding="utf-8", errors="ignore") as f:
                                    content = f.read().strip()
                                if content.startswith("gAAAAA") and app.Fernet and app.ENCRYPTION_KEY:
                                    try:
                                        fernet_instance = app.Fernet(app.ENCRYPTION_KEY.encode())
                                        decrypted_bytes = fernet_instance.decrypt(content.encode('utf-8'))
                                        content = decrypted_bytes.decode('utf-8', errors='ignore')
                                    except Exception:
                                        pass
                                if "[ERROR]" in content or "failed" in content.lower():
                                    status = "Danger / Failed"
                            except Exception:
                                pass
                                
                            healthcheck_records[dev_name] = {
                                "hostname": dev_name,
                                "latest_diagnostic_run": formatted_date,
                                "status": status,
                                "timestamp": timestamp
                            }
                
                # Scan root level files
                file_pattern = re.compile(r"^(?P<device>.+)_(?P<date>\d{8}_\d{6})\.txt$")
                for fname in sorted(os.listdir(health_dir)):
                    fpath = os.path.join(health_dir, fname)
                    if os.path.isfile(fpath):
                        m = file_pattern.match(fname)
                        if m:
                            dev_name = m.group("device")
                            date_str = m.group("date")
                            try:
                                dt = datetime.strptime(date_str, "%Y%m%d_%H%M%S")
                                formatted_date = dt.strftime("%Y-%m-%d %H:%M:%S")
                                timestamp = dt.timestamp()
                            except Exception:
                                formatted_date = date_str
                                timestamp = 0.0
                            
                            status = "Safe / OK"
                            try:
                                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                                    content = f.read().strip()
                                if content.startswith("gAAAAA") and app.Fernet and app.ENCRYPTION_KEY:
                                    try:
                                        fernet_instance = app.Fernet(app.ENCRYPTION_KEY.encode())
                                        decrypted_bytes = fernet_instance.decrypt(content.encode('utf-8'))
                                        content = decrypted_bytes.decode('utf-8', errors='ignore')
                                    except Exception:
                                        pass
                                if "[ERROR]" in content or "failed" in content.lower():
                                    status = "Danger / Failed"
                            except Exception:
                                pass
                            
                            # Update if newer than directory scan
                            if dev_name not in healthcheck_records or timestamp > healthcheck_records[dev_name]["timestamp"]:
                                healthcheck_records[dev_name] = {
                                    "hostname": dev_name,
                                    "latest_diagnostic_run": formatted_date,
                                    "status": status,
                                    "timestamp": timestamp
                                }
                
                # Convert to sorted list
                records_list = [
                    {
                        "hostname": rec["hostname"],
                        "latest_diagnostic_run": rec["latest_diagnostic_run"],
                        "status": rec["status"]
                    }
                    for rec in sorted(healthcheck_records.values(), key=lambda x: x["hostname"])
                ]
                
                report = format_healthchecks_report(records_list, total_inventory_count=len(dev_dirs))
                yield report
            except Exception as e:
                logger.error(f"Error listing healthchecks locally: {e}")
                yield f"🔴 Failed to compile healthcheck records: {str(e)}"
        return list_healthchecks_generator()

    # -----------------------------------------------------------------------
    # 4. INTENT: Compare Configs
    # -----------------------------------------------------------------------
    elif intent == "compare_configs":
        if not target_device:
            async def target_required_generator():
                yield "### 🔴 Target Device Required\n\nPlease specify which device configuration backups you want to compare (e.g., *'compare config backups for demo-core-04'*)."
            return target_required_generator()
            
        # Check if the user is asking for deep explanation/audit of changes
        if any(w in query_lower for w in ["issue", "problem", "explain", "analyze", "audit", "troubleshoot", "why", "what", "reason", "impact"]):
            logger.info("Local router: falling back to LLM for deep config comparison explanation.")
            return None
            
        async def compare_configs_generator():
            diff_content = app.get_decrypted_config_diff(target_device)
            report = format_config_comparison(target_device, diff_content)
            yield report
        return compare_configs_generator()

    # -----------------------------------------------------------------------
    # 5. INTENT: Compare Healthchecks
    # -----------------------------------------------------------------------
    elif intent == "compare_healthchecks":
        if not target_device:
            async def target_required_generator():
                yield "### 🔴 Target Device Required\n\nPlease specify which device healthchecks you want to compare (e.g., *'compare last healthchecks for demo-router-01'*)."
            return target_required_generator()
            
        # Check if the user is asking for deep issue/anomaly analysis
        if any(w in query_lower for w in ["issue", "problem", "explain", "analyze", "audit", "troubleshoot", "why", "what", "reason", "impact"]):
            logger.info("Local router: falling back to LLM for deep healthcheck anomaly analysis.")
            return None
            
        async def compare_healthchecks_generator():
            diff_content = app.get_decrypted_healthcheck_diff(target_device)
            report = format_healthcheck_comparison(target_device, diff_content)
            yield report
        return compare_healthchecks_generator()

    # -----------------------------------------------------------------------
    # 5b. INTENT: Compare Backups (Bypass)
    # -----------------------------------------------------------------------
    elif intent == "compare_backups":
        if not target_device:
            async def target_required_generator():
                yield "### 🔴 Device Name Required\n\nPlease specify which device configuration backups you want to compare (e.g., *'compare backups for Router1'*)."
            return target_required_generator()
            
        async def compare_backups_generator():
            diff_content = app.get_decrypted_config_diff(target_device)
            if "added" in query_lower:
                diff_lines = [line for line in diff_content.splitlines() if line.startswith("+") and not line.startswith("+++")]
                diff_content = "\n".join(diff_lines)
            elif "removed" in query_lower or "deleted" in query_lower:
                diff_lines = [line for line in diff_content.splitlines() if line.startswith("-") and not line.startswith("---")]
                diff_content = "\n".join(diff_lines)
                
            report = format_config_comparison(target_device, diff_content)
            yield report
        return compare_backups_generator()

    # -----------------------------------------------------------------------
    # 6. INTENT: Show Config (Bypass)
    # -----------------------------------------------------------------------
    elif intent == "show_config":
        if not target_device:
            async def target_required_generator():
                yield "### 🔴 Device Name Required\n\nPlease specify which device configuration you want to view (e.g., *'show config for demo-switch-01'*)."
            return target_required_generator()
            
        async def show_config_generator():
            extracted_config_block = app.try_parse_config_entity(target_device, query_lower)
            if extracted_config_block:
                yield extracted_config_block
                return
                
            live_config = app.get_latest_backup_config(target_device)
            if not live_config or "[No active configuration backups" in live_config:
                yield f"### 🔴 No Active Backup Found\n\nI searched your local Git repository database, but there are no configuration backups saved for **{target_device}** yet.\n\nWould you like me to trigger a new backup collection run? (type *'run backup for {target_device}'*)"
                return
                
            yield (
                f"### 📋 Decrypted Running Configuration Backup for **{target_device}**\n\n"
                f"Below is the exact, complete configuration retrieved from the secure Git backup database:\n\n"
                f"```text\n{live_config}\n```"
            )
        return show_config_generator()

    # -----------------------------------------------------------------------
    # 6b. INTENT: View Latest Healthcheck Logs (Bypass)
    # -----------------------------------------------------------------------
    elif intent in ["analyze_logs", "show_logs"]:
        if not target_device:
            async def target_required_generator():
                yield "### 🔴 Device Name Required\n\nPlease specify which device healthcheck logs you want to view (e.g., *'show logs for demo-switch-01'*)."
            return target_required_generator()
            
        async def analyze_logs_generator():
            import pipelines
            # Prefer the structured per-command analysis (status + one-line
            # summary each) — a raw healthcheck dump for a busy router can run
            # into megabytes of CLI text, unusable in a chat response. Only
            # fall back to a (size-capped) raw dump if the structured summary
            # genuinely isn't available.
            summary = await pipelines.analyze_healthcheck_summary(target_device)
            if summary:
                yield summary
                return

            live_healthcheck = app.get_latest_healthcheck(target_device)
            if not live_healthcheck:
                yield f"### 🔴 No Active Healthcheck Log Found\n\nI searched your local Git repository database, but there are no healthcheck diagnostic runs saved for **{target_device}** yet.\n\nWould you like me to trigger a new healthcheck collection run? (type *'run healthcheck for {target_device}'*)"
                return

            _RAW_CAP = 8000
            truncated = live_healthcheck[:_RAW_CAP]
            note = ""
            if len(live_healthcheck) > _RAW_CAP:
                note = f"\n\n*⚠️ Output truncated ({len(live_healthcheck):,} chars total) — ask for a specific section (e.g. 'show bgp summary for {target_device}') for full untruncated CLI output of one command.*"
            yield (
                f"### 📋 Latest Healthcheck Log for **{target_device}**\n\n"
                f"Below is diagnostic output retrieved from the secure Git healthchecks database:\n\n"
                f"```text\n{truncated}\n```"
                f"{note}"
            )
        return analyze_logs_generator()

    # -----------------------------------------------------------------------
    # 6c. INTENT: Query Healthcheck Section (Bypass)
    # -----------------------------------------------------------------------
    elif intent == "query_healthcheck_section":
        if not target_device:
            async def target_required_generator():
                yield "### 🔴 Device Name Required\n\nPlease specify which device healthcheck you want to query (e.g., *'show OSPF neighbors on PE1'*)."
            return target_required_generator()
            
        async def query_healthcheck_section_generator():
            live_healthcheck = app.get_latest_healthcheck(target_device)
            if not live_healthcheck:
                yield f"### 🔴 No Active Healthcheck Log Found\n\nI searched your local Git repository database, but there are no healthcheck diagnostic runs saved for **{target_device}** yet."
                return
                
            sec_output = extract_healthcheck_section(live_healthcheck, query_lower)
            if not sec_output:
                yield f"### 🔴 Command Section Not Found in Log\n\nI searched the latest healthcheck run for **{target_device}**, but could not find a command output matching your query."
                return
                
            # Extract actual CLI command run from first line of extracted section
            first_line = sec_output.splitlines()[0] if sec_output.splitlines() else "Command Output"
            
            yield (
                f"### 🩺 **{first_line}** for **{target_device}**\n\n"
                f"Retrieved dynamically from the latest secure Git diagnostic run:\n\n"
                f"```text\n{sec_output}\n```"
            )
        return query_healthcheck_section_generator()

    # -----------------------------------------------------------------------
    # 6d. INTENT: Query Inventory Stats (Bypass)
    # -----------------------------------------------------------------------
    elif intent == "query_inventory_stats":
        async def query_inventory_stats_generator():
            try:
                headers = {"X-Api-Key": os.getenv("APP_PASSWORD", "") or os.getenv("API_KEY", "")}
                async with httpx.AsyncClient(timeout=10.0) as client:
                    dev_resp = await client.get("http://NETAct_backend:8000/devices", headers=headers)
                    backups_resp = await client.get("http://NETAct_backend:8000/devices/backups-summary", headers=headers)
                    
                if dev_resp.status_code == 200 and backups_resp.status_code == 200:
                    devices = dev_resp.json()
                    backups = backups_resp.json()
                    backup_map = {b.get("hostname"): b for b in backups}
                    
                    routers = [d for d in devices if "router" in d.get("group", "").lower() or "router" in d.get("hostname", "").lower()]
                    switches = [d for d in devices if "switch" in d.get("group", "").lower() or "switch" in d.get("hostname", "").lower()]
                    
                    if "how many routers" in query_lower:
                        yield f"📊 **Inventory Report**: There are currently **{len(routers)}** registered routers in the network inventory."
                    elif "how many switches" in query_lower:
                        yield f"📊 **Inventory Report**: There are currently **{len(switches)}** registered switches in the network inventory."
                    elif "offline" in query_lower:
                        offline_nodes = [d.get("hostname") for d in devices if backup_map.get(d.get("hostname"), {}).get("status") == "Failed"]
                        if offline_nodes:
                            nodes_str = ", ".join([f"`{n}`" for n in offline_nodes])
                            yield f"🔴 **Offline/Unreachable Devices**: The following **{len(offline_nodes)}** devices failed their last collection run: {nodes_str}."
                        else:
                            yield "🟢 **All Systems Normal**: No registered devices are reported offline or unreachable."
                    elif "backed up" in query_lower or "without backups" in query_lower:
                        not_backed_up = [d.get("hostname") for d in devices if d.get("hostname") not in backup_map]
                        if not_backed_up:
                            nodes_str = ", ".join([f"`{n}`" for n in not_backed_up])
                            yield f"⚠️ **Devices Without Backups**: The following **{len(not_backed_up)}** devices have no configuration backups in Git: {nodes_str}."
                        else:
                            yield "🟢 **All Systems Backed Up**: Every registered node in the inventory has at least one successful backup in Git."
                    elif any(v in query_lower for v in ("nokia", "cisco", "huawei", "juniper", "arista", "nexus")):
                        vendor_kw = next(v for v in ("nokia", "cisco", "huawei", "juniper", "arista", "nexus") if v in query_lower)
                        matched = [d.get("hostname") for d in devices if vendor_kw in d.get("vendor", "").lower() or vendor_kw in d.get("hostname", "").lower()]
                        yield f"📊 **{vendor_kw.capitalize()} Devices**: Found **{len(matched)}** {vendor_kw.capitalize()} nodes: " + ", ".join([f"`{n}`" for n in matched])
                    elif "locate" in query_lower or "find" in query_lower:
                        matching = []
                        for d in devices:
                            h = d.get("hostname", "")
                            if h.lower() in query_lower or any(w in query_lower for w in h.lower().split("-")):
                                matching.append(d)
                        if matching:
                            rep = ["🔍 **Device Locations Found**:\n"]
                            for m in matching:
                                rep.append(f"* `{m.get('hostname')}` - Group: `{m.get('group')}`, Vendor: `{m.get('vendor')}`, IP: `{m.get('ip_address')}`\n")
                            yield "".join(rep)
                        else:
                            yield "🔍 **Device Search**: Could not locate any registered node matching the specified hostname search query."
                    else:
                        yield f"📊 **Network Inventory Stats**:\n* Total Nodes: **{len(devices)}**\n* Routers: **{len(routers)}**\n* Switches: **{len(switches)}**"
                else:
                    yield "🔴 Failed to retrieve inventory stats from backend APIs."
            except Exception as e:
                yield f"🔴 Error auditing inventory: {str(e)}"
        return query_inventory_stats_generator()

    # -----------------------------------------------------------------------
    # 6e. INTENT: Query Automation History (Bypass)
    # -----------------------------------------------------------------------
    elif intent == "query_automation_history":
        async def query_automation_history_generator():
            import sqlite3
            try:
                db_path = os.getenv("DB_PATH", "/app/db/copilot_history.db")
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                cursor.execute("SELECT ticket_id, device_name, action_type, status, created_at FROM itsm_tickets ORDER BY created_at DESC LIMIT 10")
                rows = cursor.fetchall()
                conn.close()
                
                if not rows:
                    yield "📊 **Automation History**: No workflows or automations have been executed yet."
                    return
                    
                report = ["### 🤖 Recent Automation Workflows Run History\n\n"]
                report.append("| Ticket ID | Device Name | Action Type | Status | Timestamp |\n")
                report.append("| :--- | :--- | :--- | :--- | :--- |\n")
                for row in rows:
                    status_icon = "🟢 Success" if row[3] == "Approved" else ("🔴 Failed" if row[3] == "Rejected" else "⏳ Pending")
                    report.append(f"| {row[0]} | {row[1]} | {row[2]} | {status_icon} | {row[4]} |\n")
                yield "".join(report)
            except Exception as e:
                yield f"🔴 Failed to query automation history database: {str(e)}"
        return query_automation_history_generator()

    # -----------------------------------------------------------------------
    # 6f. INTENT: Query Compliance Baseline (Bypass)
    # -----------------------------------------------------------------------
    elif intent == "query_compliance_baseline":
        async def query_compliance_baseline_generator():
            backups_dir = os.path.join(app.GIT_REPO_PATH, "backups")
            if not os.path.isdir(backups_dir):
                yield "### 🛡️ Baseline Compliance Report\n\nNo backups folder found to check compliance."
                return
                
            violations = []
            devices = sorted(os.listdir(backups_dir))
            
            for dev in devices:
                dev_dir = os.path.join(backups_dir, dev)
                if not os.path.isdir(dev_dir):
                    continue
                files = sorted(glob.glob(os.path.join(dev_dir, "*.txt")))
                if not files:
                    continue
                try:
                    with open(files[-1], "r", encoding="utf-8", errors="ignore") as f:
                          config = f.read()
                    if "ntp" in query_lower and "ntp-server" not in config.lower() and "ntp" not in config.lower():
                        violations.append(dev)
                    elif "snmp" in query_lower and "snmp-agent" not in config.lower() and "snmp-server" not in config.lower():
                        violations.append(dev)
                    elif "telnet" in query_lower and ("telnet server enable" in config.lower() or "protocol inbound telnet" in config.lower()):
                        violations.append(dev)
                except Exception:
                    pass
                    
            if "ntp" in query_lower:
                if violations:
                    yield f"⚠️ **NTP Compliance Violations**: The following **{len(violations)}** devices are missing NTP server declarations: " + ", ".join([f"`{v}`" for v in violations])
                else:
                    yield "🟢 **NTP Baseline Compliant**: All backing nodes have NTP configured."
            elif "snmp" in query_lower:
                if violations:
                    yield f"⚠️ **SNMP Compliance Violations**: The following **{len(violations)}** devices are missing SNMP configuration: " + ", ".join([f"`{v}`" for v in violations])
                else:
                    yield "🟢 **SNMP Baseline Compliant**: All backing nodes have SNMP configured."
            elif "telnet" in query_lower:
                if violations:
                    yield f"🔴 **Telnet Security Violations**: The following **{len(violations)}** devices have insecure Telnet protocol enabled: " + ", ".join([f"`{v}`" for v in violations])
                else:
                    yield "🟢 **Telnet Inactive**: No nodes have Telnet enabled (all using secure SSH)."
            else:
                yield "🟢 **Baseline compliance scan completed**. Use specific queries like *'show missing NTP configuration'* or *'find Telnet configurations'* to check."
        return query_compliance_baseline_generator()

    # -----------------------------------------------------------------------
    # 6g. INTENT: Query Interface Status (Bypass)
    # -----------------------------------------------------------------------
    elif intent == "query_interface_status":
        if not target_device:
            async def target_required_generator():
                yield "### 🔴 Device Name Required\n\nPlease specify which device interface details you want to view (e.g., *'show interfaces down on Router1'*)."
            return target_required_generator()
            
        async def query_interface_status_generator():
            live_healthcheck = app.get_latest_healthcheck(target_device)
            if not live_healthcheck:
                yield f"### 🔴 No Active Healthcheck Log Found for **{target_device}**."
                return
                
            # If utility rate is queried, prefer the detailed display interface output over interface brief
            sec_output = None
            if any(w in query_lower for w in ["utility", "rate", "output", "input"]):
                sec_output = extract_healthcheck_section(live_healthcheck, "display interface")
            if not sec_output:
                sec_output = extract_healthcheck_section(live_healthcheck, "interfaces")
                
            if not sec_output:
                yield f"### 🔴 Interface Logs Not Found\n\nCould not locate interface status tables in the latest diagnostic log for **{target_device}**."
                return
                
            lines = sec_output.splitlines()
            matching_lines = []
            
            # Check for comparison math threshold filters (e.g. more than 80)
            math_filter = parse_numeric_filter(query_lower)
            
            if math_filter:
                op, threshold = math_filter
                current_interface = "Unknown"
                for line in lines:
                    # Keep track of the active interface context
                    if "current state" in line.lower() or "current-state" in line.lower():
                        parts = line.split()
                        if parts:
                            current_interface = parts[0]
                    # Parse utility rates
                    if "utility rate" in line.lower():
                        pct_match = re.search(r'(\d+(?:\.\d+)?)\s*%', line)
                        if pct_match:
                            val = float(pct_match.group(1))
                            match_condition = False
                            if op == ">" and val > threshold:
                                match_condition = True
                            elif op == "<" and val < threshold:
                                match_condition = True
                            elif op == "=" and val == threshold:
                                match_condition = True
                                
                            if match_condition:
                                matching_lines.append(f"{current_interface:<30} | {line.strip()}")
            else:
                # Default text-based classification filters (down, crc, flaps)
                for line in lines:
                    if "down" in query_lower and ("down" in line.lower() or "offline" in line.lower()):
                        matching_lines.append(line)
                    elif "crc" in query_lower and ("crc" in line.lower() or "error" in line.lower()):
                        matching_lines.append(line)
                    elif "utility" in query_lower or "rate" in query_lower:
                        if "utility rate" in line.lower() and not "0.00%" in line and not "0%" in line:
                            matching_lines.append(line)
                       
            if matching_lines:
                yield f"### 🩺 Interface Analysis for **{target_device}**\n\n```text\n" + "\n".join(matching_lines) + "\n```"
            else:
                yield f"🟢 **All Interfaces Normal**: No anomalous status found matching your interface query on **{target_device}**."
        return query_interface_status_generator()

    # -----------------------------------------------------------------------
    # 7. INTENT: Active Alarms / Incidents Summary (Bypass)
    # -----------------------------------------------------------------------
    elif intent in ["active_alarms", "list_alarms", "failed_incidents"]:
        async def active_alarms_generator():
            yield "⚡ **[Fast-Path] Active Alerts & Failed Incidents Report**\n\n"
            
            # Part 1: Failed Backups
            backups_dir = os.path.join(app.GIT_REPO_PATH, "backups")
            failed_backups = []
            if os.path.isdir(backups_dir):
                for dev_name in sorted(os.listdir(backups_dir)):
                    dev_dir = os.path.join(backups_dir, dev_name)
                    if not os.path.isdir(dev_dir):
                        continue
                    files = sorted(glob.glob(os.path.join(dev_dir, "*.txt")))
                    if files:
                        latest_file = files[-1]
                        try:
                            with open(latest_file, "r", encoding="utf-8", errors="ignore") as f:
                                content = f.read().strip()
                            if content.startswith("gAAAAA") and app.Fernet and app.ENCRYPTION_KEY:
                                try:
                                    fernet_instance = app.Fernet(app.ENCRYPTION_KEY.encode())
                                    decrypted_bytes = fernet_instance.decrypt(content.encode('utf-8'))
                                    content = decrypted_bytes.decode('utf-8', errors='ignore')
                                except Exception:
                                    pass
                            if "[ERROR]" in content or "failed" in content.lower():
                                failed_backups.append(dev_name)
                        except Exception:
                            pass
                            
            # Part 2: Unhealthy Healthchecks
            health_dir = os.path.join(app.GIT_REPO_PATH, "healthchecks")
            failed_health = []
            if os.path.isdir(health_dir):
                for dev_name in sorted(os.listdir(health_dir)):
                    dev_dir = os.path.join(health_dir, dev_name)
                    if not os.path.isdir(dev_dir):
                        continue
                    files = sorted(glob.glob(os.path.join(dev_dir, "*.txt")))
                    if files:
                        latest_file = files[-1]
                        try:
                            with open(latest_file, "r", encoding="utf-8", errors="ignore") as f:
                                content = f.read().strip()
                            if content.startswith("gAAAAA") and app.Fernet and app.ENCRYPTION_KEY:
                                try:
                                    fernet_instance = app.Fernet(app.ENCRYPTION_KEY.encode())
                                    decrypted_bytes = fernet_instance.decrypt(content.encode('utf-8'))
                                    content = decrypted_bytes.decode('utf-8', errors='ignore')
                                except Exception:
                                    pass
                            if "[ERROR]" in content or "failed" in content.lower():
                                failed_health.append(dev_name)
                        except Exception:
                            pass
            
            if not failed_backups and not failed_health:
                yield "🟢 **All Systems Normal**: No active configuration backup failures or unhealthy device diagnostic runs detected today."
                return
                
            report = []
            if failed_backups:
                report.append("### 🔴 FAILED CONFIGURATION BACKUPS\n\n")
                for fb in failed_backups:
                    report.append(f"- **{fb}**: Git backup run failed (Check device connectivity/credentials).\n")
                report.append("\n")
                
            if failed_health:
                report.append("### 🔴 UNHEALTHY DIAGNOSTIC RUNS (HEALTHCHECKS)\n\n")
                for fh in failed_health:
                    report.append(f"- **{fh}**: Unhealthy state or diagnostic errors detected in the latest healthcheck.\n")
                report.append("\n")
                
            report.append("> [!CRITICAL]\n")
            report.append("> One or more systems are experiencing operational failures. Immediate troubleshooting is recommended.\n")
            
            yield "".join(report)
        return active_alarms_generator()

    # -----------------------------------------------------------------------
    # 7.5 INTENT: ITSM Change Ticket Query
    # -----------------------------------------------------------------------
    elif intent == "itsm_query":
        async def itsm_query_generator():
            import sqlite3
            import re as _re
            import agent as _agent
            try:
                conn = sqlite3.connect(_agent.DB_PATH)
                conn.row_factory = sqlite3.Row

                ticket_id_match = _re.search(r'\bCHG\d+\b', query_lower, _re.IGNORECASE)
                status_filter = None
                if "pending" in query_lower:
                    status_filter = "Pending"
                elif "approved" in query_lower:
                    status_filter = "Approved"
                elif "rejected" in query_lower:
                    status_filter = "Rejected"

                if ticket_id_match:
                    rows = conn.execute(
                        "SELECT * FROM itsm_tickets WHERE ticket_id = ? COLLATE NOCASE",
                        (ticket_id_match.group(0),)
                    ).fetchall()
                elif device_str:
                    rows = conn.execute(
                        "SELECT * FROM itsm_tickets WHERE device_name = ? COLLATE NOCASE ORDER BY created_at DESC",
                        (device_str,)
                    ).fetchall()
                elif status_filter:
                    rows = conn.execute(
                        "SELECT * FROM itsm_tickets WHERE status = ? ORDER BY created_at DESC",
                        (status_filter,)
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT * FROM itsm_tickets ORDER BY created_at DESC LIMIT 20"
                    ).fetchall()
                conn.close()

                if not rows:
                    yield "📋 **ITSM Tickets**: No matching change tickets found."
                    return

                report = [f"📋 **ITSM Change Tickets** ({len(rows)} found):\n\n"]
                for r in rows:
                    status_icon = {"Pending": "🟡", "Approved": "🟢", "Rejected": "🔴"}.get(r["status"], "⚪")
                    report.append(
                        f"- {status_icon} **{r['ticket_id']}** — `{r['device_name']}` — {r['action_type']} "
                        f"— *{r['status']}* — {r['description']} ({r['created_at']})\n"
                    )
                yield "".join(report)
            except Exception as e:
                logger.error(f"itsm_query error: {e}")
                yield f"🔴 Failed to query ITSM tickets: {str(e)}"
        return itsm_query_generator()

    # -----------------------------------------------------------------------
    # 8. INTENT: Live Network-Wide Status (real-time Topology API)
    # -----------------------------------------------------------------------
    elif intent == "live_topology_status":
        async def live_topology_status_generator():
            import pipelines
            topo_text = await pipelines.query_topology_api_live(query_lower)
            if not topo_text:
                yield "🔴 **Topology API unavailable** — cannot retrieve live network status. Check that the topology stack is running."
                return
            yield format_live_network_status(topo_text)
        return live_topology_status_generator()

    # -----------------------------------------------------------------------
    # 9. INTENT: Live Device Status (real-time Topology API)
    # -----------------------------------------------------------------------
    elif intent == "live_device_status":
        if not target_device:
            async def no_device_generator():
                yield "### 🔴 Device Name Required\n\nPlease specify which device you want live status for (e.g. *'is demo-router-01 up?'*)."
            return no_device_generator()

        async def live_device_status_generator():
            import pipelines
            topo_text = await pipelines.query_topology_api_live(query_lower, device=target_device)
            if not topo_text:
                yield f"🔴 **Topology API unavailable** — cannot retrieve live status for **{target_device}**."
                return
            yield format_live_device_status(topo_text, target_device)
        return live_device_status_generator()

    # -----------------------------------------------------------------------
    # 9b. INTENT: Protocol Neighbor Count (real-time Topology API, no LLM)
    # -----------------------------------------------------------------------
    elif intent == "count_protocol_neighbors":
        if not target_device:
            async def no_device_generator():
                yield "### 🔴 Device Name Required\n\nPlease specify which device (e.g. *'how many BGP neighbors for demo-router-01?'*)."
            return no_device_generator()

        async def count_protocol_neighbors_generator():
            import pipelines
            protocol = next(
                (p for p in ("bgp", "ospf", "lldp", "isis") if p in query_lower or (p == "isis" and "is-is" in query_lower)),
                None,
            )
            if not protocol:
                yield "### 🔴 Protocol Not Recognized\n\nPlease specify which protocol (BGP, OSPF, LLDP, or ISIS)."
                return
            count = await pipelines.count_protocol_neighbors(target_device, protocol)
            if count is None:
                yield f"🔴 **Topology API unavailable or device not found** — cannot count {protocol.upper()} neighbors for **{target_device}**."
                return
            yield (
                f"⚡ **[Live] {protocol.upper()} Neighbor Count — {target_device}**\n\n"
                f"**{count}** {protocol.upper()} {'session' if count == 1 else 'sessions'} in the live topology graph.\n\n"
                f"> ℹ️ Data retrieved directly from the Topology API — always current, zero lag."
            )
        return count_protocol_neighbors_generator()

    # -----------------------------------------------------------------------
    # 9c. INTENT: Protocol Neighbor Status Breakdown (context follow-up)
    # -----------------------------------------------------------------------
    elif intent == "count_protocol_neighbor_status":
        if not target_device:
            async def no_device_generator():
                yield "### 🔴 Device Name Required\n\nPlease specify which device you mean."
            return no_device_generator()

        async def count_protocol_neighbor_status_generator():
            import pipelines
            protocol = next(
                (p for p in ("bgp", "ospf", "lldp", "isis") if p in query_lower or (p == "isis" and "is-is" in query_lower)),
                None,
            ) or _scan_history_for_protocol(history)
            if not protocol:
                yield "### 🔴 Protocol Not Recognized\n\nPlease specify which protocol (BGP, OSPF, LLDP, or ISIS)."
                return
            status = await pipelines.get_protocol_neighbor_status(target_device, protocol)
            if status is None:
                yield f"🔴 **Topology API unavailable or device not found** — cannot check {protocol.upper()} status for **{target_device}**."
                return
            yield (
                f"⚡ **[Live] {protocol.upper()} Neighbor Status — {target_device}**\n\n"
                f"🟢 **{status['up']}** up · 🔴 **{status['down']}** down "
                f"(**{status['total']}** total {protocol.upper()} sessions)\n\n"
                f"> ℹ️ Data retrieved directly from the Topology API — always current, zero lag."
            )
        return count_protocol_neighbor_status_generator()

    # -----------------------------------------------------------------------
    # 10. INTENT: EOL/EOS Compliance (real-time backend registry, no LLM)
    # -----------------------------------------------------------------------
    elif intent == "eoleos_compliance":
        async def eoleos_compliance_generator():
            import pipelines
            records = await pipelines.query_eoleos_compliance_live(device=target_device)
            if records is None:
                yield "🔴 **Backend API unavailable** — cannot retrieve live EOL/EOS compliance data. Check that the core backend stack is running."
                return
            yield format_eoleos_compliance(records)
        return eoleos_compliance_generator()

    # Fall back to LLM processing path
    return None



# ---------------------------------------------------------------------------
# Device extraction helper — single canonical implementation
# ---------------------------------------------------------------------------
_DEVICE_PREFIXES = ("ISP-", "ES-", "WAC-", "KTC-", "KTR-", "WBC-", "ES_", "DR_")
_DEVICE_SUFFIXES = ("-01", "-02", "-03", "-04", "-05")
_DEVICE_ROLE_PATTERNS = [
    re.compile(r'^[a-z]+-tor\d*$'),
    re.compile(r'^[a-z]+-eor\d*$'),
    re.compile(r'^[a-z]+-gw\d*$'),
    re.compile(r'^[a-z]+-core\d*$'),
    re.compile(r'^[a-z]+-spine\d*$'),
    re.compile(r'^[a-z]+-leaf\d*$'),
]

def extract_healthcheck_section(log_content: str, query: str) -> Optional[str]:
    """Helper to extract a specific command output section from the decrypted healthcheck run log using dynamic query token matching."""
    query_lower = query.lower().strip()
    
    # 1. Tokenize query, clean punctuation, and filter stop words
    query_clean = query_lower.replace("-", " ").replace("_", " ")
    query_words = [w.strip(".,;:?!'\"()[]{}") for w in query_clean.split()]
    
    stop_words = {
        "share", "healthcheck", "healthehck", "for", "show", "get", "view", "last", "latest", "results", 
        "log", "config", "backup", "running", "device", "node", "router", "switch", "the", "me", "active", 
        "alarm", "unresolved", "at", "on", "in", "from", "of", "display", "compare", "list", "check", "diff",
        "history", "what", "changed", "since", "yesterday", "today", "week", "between", "whose", "status",
        "went", "down", "up", "peers", "state", "differences", "cpu", "changes", "memory", "usage", 
        "temperature", "hardware", "alarms", "workflow", "automation", "executed", "duration", 
        "simulation", "mode", "router1", "router2", "router5", "router10", "pe1", "pe2", "pe12",
        "es-iptv-tor23", "isp-ktc-core-ne9000-01", "isp-lon-gw-01", "isp-lon-gw-02", "ktc-p-ne40e-x8a",
        "wac-p-ne40e-x8a", "wbc-agg-ncs5504", "how", "many", "much", "count", "total", "number", "there", "are"
    }
    
    query_tokens = [w for w in query_words if w and w not in stop_words]
    if not query_tokens:
        return None

    # Map query synonyms to actual command line terms
    synonym_map = {
        "neighbors": ["peer", "neighbor"],
        "neighbor": ["peer", "neighbor"],
        "peers": ["peer", "neighbor"],
        "peer": ["peer", "neighbor"],
        "routing": ["route", "routing"],
        "route": ["route", "routing"],
        "interfaces": ["interface", "interfaces"],
        "interface": ["interface", "interfaces"],
        "optics": ["transceiver", "optic", "optical"],
        "optical": ["transceiver", "optic", "optical"],
        "transceiver": ["transceiver", "optic", "optical"]
    }
    
    # 2. Extract command headers from healthcheck log
    lines = log_content.splitlines()
    command_indices = []
    for i, line in enumerate(lines):
        if line.strip().startswith(">>>"):
            command_indices.append((i, line.strip()))
            
    if not command_indices:
        return None
        
    best_idx = -1
    best_score = 0
    best_cmd_len = 999
    
    for idx, cmd_line in command_indices:
        cmd_clean = cmd_line.lower().replace(">>>", "").replace("-", " ").replace("_", " ")
        cmd_words = cmd_clean.split()
        
        score = 0
        for token in query_tokens:
            if token in synonym_map:
                if any(syn in cmd_words for syn in synonym_map[token]):
                    score += 1
            else:
                if token in cmd_words:
                    score += 1
                    
        if score > 0:
            if score > best_score:
                best_score = score
                best_idx = idx
                best_cmd_len = len(cmd_words)
            elif score == best_score:
                if len(cmd_words) < best_cmd_len:
                    best_idx = idx
                    best_cmd_len = len(cmd_words)
                    
    if best_idx == -1:
        return None
        
    # 3. Slice the log starting from the matched index
    extracted = []
    for line in lines[best_idx:]:
        stripped = line.strip()
        if stripped.startswith(">>>") and len(extracted) > 0:
            break
        if re.match(r'^={10,}$', stripped):
            continue
        extracted.append(line)
        
    return "\n".join(extracted).strip()

def parse_numeric_filter(query: str) -> Optional[tuple[str, float]]:
    """Parses comparison filters from user query (e.g. 'more than 80', 'below -12.5').
    Returns a tuple of (operator, threshold_value) or None."""
    query_lower = query.lower()
    
    operators = {
        ">": ["more than", "greater than", "above", "exceed", ">"],
        "<": ["less than", "below", "under", "less", "<"],
        "=": ["equal to", "equals", "="]
    }
    
    matched_op = None
    matched_idx = -1
    for op, synonyms in operators.items():
        for syn in synonyms:
            idx = query_lower.find(syn)
            if idx != -1:
                if matched_op is None or idx < matched_idx:
                    matched_op = op
                    matched_idx = idx + len(syn)
                    
    if matched_op is None or matched_idx == -1:
        return None
        
    text_after_op = query_lower[matched_idx:]
    match = re.search(r'-?\b\d+(?:\.\d+)?\b', text_after_op)
    if match:
        val = float(match.group(0))
        return (matched_op, val)
        
    return None

def _extract_device(text: str) -> Optional[str]:
    """Extract the first device hostname or IP address from text. Used as LLM fallback."""
    # IP address takes priority
    ip = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", text)
    if ip:
        return ip.group(0)
    # Hostname pattern matching
    for word in text.split():
        clean = word.strip(".,;:?!'\"()[]{}")
        upper = clean.upper()
        if any(upper.startswith(p.upper()) for p in _DEVICE_PREFIXES):
            return clean
        if any(clean.endswith(s) for s in _DEVICE_SUFFIXES):
            return clean
        cl = clean.lower()
        if any(pat.match(cl) for pat in _DEVICE_ROLE_PATTERNS):
            return clean
    return None


def _scan_history_for_protocol(history: list) -> Optional[str]:
    """Scans recent conversation history (most recent user message first) for a
    mentioned protocol (bgp/ospf/lldp/isis) — used to resolve short follow-up
    questions like 'how many are up?' that don't name a protocol themselves."""
    for h in reversed(history or []):
        h_role = h.get("role") if isinstance(h, dict) else getattr(h, "role", "")
        h_content = h.get("content") if isinstance(h, dict) else getattr(h, "content", "")
        if h_role != "user" or not h_content:
            continue
        h_lower = h_content.lower()
        for p in ("bgp", "ospf", "lldp", "isis"):
            if p in h_lower or (p == "isis" and "is-is" in h_lower):
                return p
    return None


# ---------------------------------------------------------------------------
# Intent classifier — LLM-first, thin Python safety net
# ---------------------------------------------------------------------------
async def classify_intent_with_ollama(
    query: str,
    history: List[Any] = [],
    mode: str = "copilot_only",
    model: Optional[str] = None
) -> dict:
    import config_loader
    import vector_sync
    import httpx

    OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://NETAct_ollama:11434")
    OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")
    OLLAMA_NUM_THREAD = int(os.getenv("OLLAMA_NUM_THREAD", "24"))
    # Classification only needs to emit a short label/JSON — a small general-instruct
    # model classifies far faster here than the larger synthesis model.
    CLASSIFIER_MODEL = os.getenv("CLASSIFIER_MODEL", OLLAMA_MODEL)
    active_model = model or CLASSIFIER_MODEL
    query_lower = query.lower().strip()

    # Fetch inventory dynamically to match device names/IPs exactly
    devices_list = []
    try:
        inv_headers = {"X-Api-Key": os.getenv("APP_PASSWORD", "") or os.getenv("API_KEY", "")}
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get("http://NETAct_backend:8000/devices", headers=inv_headers)
            if resp.status_code == 200:
                devices_list = resp.json()
            else:
                logger.warning(f"Inventory fetch for fast-path returned HTTP {resp.status_code}")
    except Exception as e:
        logger.warning(f"Failed to fetch inventory for fast-path: {e}")

    extracted_device = None
    # 1. First check if any IP address matches — but skip this for ping/traceroute
    # queries, where the IP is the reachability TARGET (deliberately often outside
    # your own inventory, e.g. "ping 8.8.8.8"), not a device being looked up. Any
    # source device in those queries (e.g. "... from demo-router-01") still gets
    # picked up by the word/substring matching steps below.
    extracted_device_from_ip = None
    _is_diag_target_query = any(p in query.lower() for p in ("ping ", "traceroute"))
    ip_match = None if _is_diag_target_query else re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", query)
    if ip_match:
        ip_str = ip_match.group(0)
        found_ip = False
        for dev in devices_list:
            if dev.get("ip_address") == ip_str:
                extracted_device = dev.get("hostname")
                extracted_device_from_ip = extracted_device
                found_ip = True
                break
        if not found_ip:
            logger.info(f"Instant override: unregistered_ip ({ip_str})")
            return {"intent": "unregistered_ip", "device": None, "flow_name": None, "route": "local_python"}

    # 2. Match device by normalized words (e.g. "ISP LON GW" -> "demo-router-01")
    if not extracted_device and not ip_match:
        query_clean = query.lower().replace("-", " ").replace("_", " ")
        query_words = [w.strip(".,;:?!'\"()[]{}") for w in query_clean.split()]
        stop_words = {
            "share", "healthcheck", "healthehck", "for", "show", "get", "view", "last", "latest", "results", "log", "config", 
            "backup", "running", "device", "node", "router", "switch", "the", "me", "active", "alarm", "unresolved",
            "ospf", "bgp", "arp", "lldp", "isis", "mpls", "route", "routing", "qos", "optical", "interfaces", "interface", 
            "neighbors", "neighbor", "peers", "peer", "summary", "table", "database", "at", "on", "in", "from", "of", "display", 
            "compare", "list", "check", "diff", "history", "what", "changed", "since", "yesterday", "today", "week", "between",
            "whose", "status", "went", "down", "up", "peers", "state", "differences", "cpu", "changes", "memory", "usage", 
            "temperature", "hardware", "alarms", "workflow", "automation", "executed", "duration", "simulation", "mode",
            "more", "than", "above", "below", "under", "greater", "less", "equal", "seconds", "output", "utility", "rate"
        }
        query_device_words = [
            w for w in query_words 
            if w and w not in stop_words 
            and not re.match(r'^-?\d+(?:\.\d+)?$', w)
        ]
        
        if query_device_words:
            matched_candidates = []
            for dev in devices_list:
                hname = dev.get("hostname", "")
                if not hname:
                    continue
                hname_clean = hname.lower().replace("-", " ").replace("_", " ")
                hname_words = hname_clean.split()
                matched_words = sum(1 for w in query_device_words if w in hname_words)
                
                if matched_words == len(query_device_words):
                    matched_candidates.append(hname)
            
            if len(matched_candidates) == 1:
                extracted_device = matched_candidates[0]
            elif len(matched_candidates) > 1:
                # Word-matching strips numeric tokens (e.g. the "01" in "-01"),
                # which can make distinguishable hostnames look identical when
                # the query has no other noise words to break the tie. Before
                # asking for clarification, check whether the query actually
                # contains one candidate's full hostname verbatim — if so, that's
                # not really ambiguous, the digit stripping just hid the answer.
                exact_hits = [c for c in matched_candidates if c.lower() in query_lower]
                if len(exact_hits) == 1:
                    extracted_device = exact_hits[0]
                else:
                    logger.info(f"Instant override: clarify_device (candidates: {matched_candidates})")
                    return {"intent": "clarify_device", "device": None, "flow_name": None, "route": "local_python"}

    # 3. Fallback to substring matching
    if not extracted_device and not ip_match:
        for dev in devices_list:
            hname = dev.get("hostname")
            if hname and hname.lower() in query_lower:
                extracted_device = hname
                break

    # 4. Fallback to prefix/suffix regex helper if inventory fetch failed or didn't match.
    # This is a pure naming-pattern match (e.g. "ISP-*", "*-01") — unlike steps 1-3 it is
    # NEVER checked against the real inventory, so it happily accepts typos/nonexistent
    # devices. If the inventory fetch actually succeeded, verify the guess is real before
    # accepting it — otherwise a typo'd device silently sails into full LLM reasoning (and
    # potentially live tool execution against a device that was never real) instead of a
    # fast, clear "not registered" answer.
    if not extracted_device and not ip_match:
        pattern_guess = _extract_device(query)
        if pattern_guess:
            if devices_list:
                real_hit = next((d.get("hostname") for d in devices_list if d.get("hostname", "").lower() == pattern_guess.lower()), None)
                if real_hit:
                    extracted_device = real_hit
                else:
                    logger.info(f"Instant override: unregistered_device ({pattern_guess})")
                    return {"intent": "unregistered_device", "device": pattern_guess, "flow_name": None, "route": "local_python"}
            else:
                # Inventory fetch itself failed — can't verify either way, fall back
                # to the old best-effort behavior rather than block everything.
                extracted_device = pattern_guess

    # 5. Conversation-history fallback — same safety rule as resolve_device() in
    # app.py: never guess a device from history for operational-looking commands
    # (run/execute/trigger/...), only for informational follow-ups like
    # "how many are up?" after "how many BGP neighbors for X?".
    #
    # This previously had no topical-relevance check at all: ANY query with no
    # device match of its own inherited whatever device was last mentioned in
    # history, even a fully self-contained question naming its own platform
    # (e.g. "how to configure OSPF Neighborship at Huawei NE9000 Router" —
    # confirmed live to wrongly inherit an unrelated inventory device from
    # earlier in the same thread). A query that already names a platform/model
    # of its own (NE9000, ASR9000, NCS5500, ...) is a documentation-style
    # question about that platform, not a follow-up about "the same device as
    # before" — skip carry-forward in that case.
    _PLATFORM_MODEL_RE = re.compile(r"\b[a-z]{2,4}\d{3,5}\b", re.IGNORECASE)
    query_names_own_platform = bool(_PLATFORM_MODEL_RE.search(query))
    _OPERATIONAL_PREFIXES = ("run ", "execute ", "trigger ", "collect ", "start ", "perform ")
    is_operational = query_lower.startswith(_OPERATIONAL_PREFIXES)
    context_protocol = None
    if not extracted_device and not ip_match and not is_operational and not query_names_own_platform and history:
        for h in reversed(history[:-1] if len(history) > 0 else history):
            h_role = h.get("role") if isinstance(h, dict) else getattr(h, "role", "")
            h_content = h.get("content") if isinstance(h, dict) else getattr(h, "content", "")
            if h_role != "user" or not h_content:
                continue
            h_lower = h_content.lower()
            hist_ip_match = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", h_content)
            if hist_ip_match:
                for dev in devices_list:
                    if dev.get("ip_address") == hist_ip_match.group(0):
                        extracted_device = dev.get("hostname")
                        break
            if not extracted_device:
                for dev in devices_list:
                    hname = dev.get("hostname")
                    if hname and hname.lower() in h_lower:
                        extracted_device = hname
                        break
            if not extracted_device:
                extracted_device = _extract_device(h_content)
            for p in ("bgp", "ospf", "lldp", "isis"):
                if p in h_lower or (p == "isis" and "is-is" in h_lower):
                    context_protocol = p
                    break
            if extracted_device:
                break

    # ------------------------------------------------------------------
    # INSTANT OVERRIDES — zero latency, no LLM
    # ------------------------------------------------------------------

    # 1. Date / time query
    _time_exact = {"date", "time"}
    _time_phrases = (
        "current date", "current time", "what is the date", "what is the time",
        "what time is it", "today's date", "todays date",
        "share the current date", "share the current time",
    )
    if query_lower in _time_exact or any(p in query_lower for p in _time_phrases):
        logger.info("Instant override: current_time")
        return {"intent": "current_time", "device": None, "flow_name": None, "route": "local_ollama"}

    # 1.05 Meta / capability questions — short, common, and easily misfired on by
    # the small classifier model (e.g. "what can you do?" was landing on
    # run_diagnostic). These are unambiguous enough to answer deterministically.
    _meta_phrases = (
        "what can you do", "what can you help", "what do you do",
        "what are you able to do", "what are your capabilities",
        "show me everything", "show everything",
    )
    if any(p in query_lower for p in _meta_phrases):
        logger.info("Instant override: general_chat (meta/capability question)")
        return {"intent": "general_chat", "device": None, "flow_name": None, "route": "local_ollama"}

    # 1.055 Configuration/protocol documentation questions — "share OSPF
    # configuration examples for Cisco IOS XR" names a vendor/platform, not a
    # registered device, but "config"/"show " keywords (show_config,
    # run_diagnostic) still tempt both the deterministic fast-paths and the
    # LLM classifier itself into treating it as device-specific — the LLM
    # reliably hallucinates a device name (e.g. "OSPF", "Juniper") to fill the
    # JSON schema even with few-shot examples showing this exact pattern
    # should be general_chat (same small-model instruction-following gap as
    # the "is X stable" case — prompt examples alone weren't reliable enough).
    _doc_example_words = ("example", "sample", "template")
    _config_words = ("config", "configuration")
    if not extracted_device and not ip_match and any(w in query_lower for w in _doc_example_words) and any(w in query_lower for w in _config_words):
        logger.info("Instant override: general_chat (config example/documentation question)")
        return {"intent": "general_chat", "device": None, "flow_name": None, "route": "vector_db"}

    # 1.06 Gemini keyword — user wants to escalate to cloud model, show the gate.
    # Checked before the generic keyword fast-paths below so an explicit escalation
    # request isn't silently swallowed by an unrelated keyword match (e.g. "use
    # gemini to review this config" was landing on show_config because "config"
    # matched first).
    if "gemini" in query_lower:
        _exec_prefixes = ("run ", "execute ", "trigger ", "collect ", "start ", "perform ")
        if not any(query_lower.startswith(p) for p in _exec_prefixes):
            logger.info("Instant override: gemini escalation → general_chat")
            return {"intent": "general_chat", "device": None, "flow_name": None, "route": "vector_db"}

    # 1.1 Dynamic List & Show Overrides loaded from rules_config.json
    overrides = config_loader.load_rules_config().get("fast_path_overrides", {})

    def _kw_hit(kw: str, text: str) -> bool:
        # Short, single-word keywords (e.g. "eos", "eol") risk matching as a
        # substring inside unrelated words (e.g. "eos" inside "UpgradeOSPF" or
        # "videos") — use a word-boundary check for those. Multi-word phrases
        # are inherently specific enough that plain substring matching is safe.
        if " " not in kw and len(kw) <= 4:
            return re.search(r'\b' + re.escape(kw) + r'\b', text) is not None
        return kw in text

    for intent_name, keywords in overrides.items():
        if not any(_kw_hit(kw, query_lower) for kw in keywords):
            continue
            
        # Verification guards to prevent false-positive overrides on help/how-to queries
        if intent_name == "list_healthchecks":
            if "health" not in query_lower and "diagnostic report" not in query_lower:
                continue
            if any(re.search(r'\b' + re.escape(kw) + r'\b', query_lower) for kw in ["run", "execute", "trigger", "collect", "perform", "start"]):
                continue
        elif intent_name == "show_config":
            if not any(kw in query_lower for kw in ["list", "show", "get", "view", "available", "last", "latest", "share", "read"]):
                continue
            # "config" is a substring of "configuration" — "share OSPF
            # configuration examples for Cisco IOS XR" matches the keyword
            # and the "share" guard above, but it's a documentation/example
            # question, not a request for one specific device's stored
            # backup. Require an actual registered device to have been found
            # in the query; without one there's nothing to show a backup of,
            # and letting it through here meant device resolution fell back
            # to whatever device was last discussed in conversation history —
            # a general knowledge question inheriting an unrelated device's
            # "no backup found" error.
            if not extracted_device:
                continue
        elif intent_name in ("analyze_logs", "query_healthcheck_section", "query_interface_status"):
            if not any(kw in query_lower for kw in ["show", "display", "share", "get", "view", "last", "latest", "results", "analyze", "list", "diagnose", "stable", "unstable", "why is", "causing"]):
                continue
            # Same reasoning as show_config above — these all require a real
            # device's stored data, so require one was actually found in the
            # query rather than letting history carry-forward supply an
            # unrelated device for what may be a general question.
            if not extracted_device:
                continue
                
        logger.info(f"Instant override: {intent_name}")
        return {"intent": intent_name, "device": extracted_device, "flow_name": None, "route": "local_python"}


    # 1.2 Agent fast-path — operational intents that bypass Ollama classification.
    # Checked AFTER fast_path_overrides so those take priority (e.g. "show config"
    # is caught above before "show " would match run_diagnostic here).
    agent_fast_path = config_loader.load_rules_config().get("agent_fast_path_keywords", {})
    for intent_name, keywords in agent_fast_path.items():
        if any(_kw_hit(kw, query_lower) for kw in keywords):
            # Every one of these except list_nodes acts on one specific
            # device — without a real extracted device, "show "/"display "
            # (run_diagnostic's broadest keywords) false-positive on generic
            # documentation questions like "show me a sample BGP config for
            # Juniper" (a vendor name, not a device). Let those fall through
            # to LLM classification instead of assuming an operational intent
            # with no target.
            if intent_name != "list_nodes" and not extracted_device:
                continue
            logger.info("Agent fast-path (rules_config): %s → device=%s", intent_name, extracted_device)
            return {"intent": intent_name, "device": extracted_device, "flow_name": None, "route": "local_ollama"}

    # 1.3a Protocol neighbor/session count — "how many BGP neighbors for X" —
    # answer with a direct number from live topology graph edges, never a raw
    # CLI dump (that's a different intent, query_healthcheck_section, for when
    # the user actually asks to "show"/"display" the section).
    _count_phrases = ("how many", "how much", "count of", "number of", "total number", "total of", "total ")
    _protocol_keywords = ("bgp", "ospf", "lldp", "isis", "is-is")
    _neighbor_words = ("neighbor", "neighbour", "peer", "session", "adjacenc")
    if (
        extracted_device
        and any(p in query_lower for p in _count_phrases)
        and any(pk in query_lower for pk in _protocol_keywords)
        and any(nw in query_lower for nw in _neighbor_words)
    ):
        logger.info("Instant override: count_protocol_neighbors → device=%s", extracted_device)
        return {"intent": "count_protocol_neighbors", "device": extracted_device, "flow_name": None, "route": "local_python"}

    # 1.3a-2 Protocol neighbor status breakdown — a short follow-up like "how
    # many are up and how many are down?" with no device/protocol of its own,
    # reusing the device+protocol just discussed (resolved via the history
    # fallback above, step 5).
    _status_words = ("up", "down", "established", "active", "idle")
    if (
        extracted_device
        and context_protocol
        and any(re.search(r'\b' + w + r'\b', query_lower) for w in _status_words)
        and any(p in query_lower for p in _count_phrases + ("how are", "which are", "breakdown"))
    ):
        logger.info(
            "Instant override: count_protocol_neighbor_status (context follow-up) → device=%s protocol=%s",
            extracted_device, context_protocol,
        )
        return {"intent": "count_protocol_neighbor_status", "device": extracted_device, "flow_name": None, "route": "local_python"}

    # 1.3 Live topology / device status — always bypass LLM, query API directly
    _live_network_phrases = (
        "network status", "topology status", "network health", "what's down",
        "whats down", "what is down", "any devices down", "any links down",
        "any failures", "any outages", "live topology", "current topology",
        "real-time status", "which devices are down", "what devices are down",
        "show me what's down", "show me whats down", "what's happening on the network",
        "whats happening on the network", "anything down", "network overview",
    )
    _live_device_words = (
        "up", "down", "reachable", "unreachable", "status", "live status",
        "current status", "status right now", "currently up", "currently down",
        "right now", "at this moment", "ping", "can reach",
    )
    if any(p in query_lower for p in _live_network_phrases):
        logger.info("Instant override: live_topology_status")
        return {"intent": "live_topology_status", "device": None, "flow_name": None, "route": "local_python"}
    if extracted_device and not query_lower.startswith("why"):
        # "why is X down" wants a root-cause explanation (analyze_logs), not the
        # binary up/down answer live_device_status gives — let it fall through.
        q_words = set(re.findall(r'\b\w+\b', query_lower))
        if any(w in q_words for w in _live_device_words):
            logger.info("Instant override: live_device_status → device=%s", extracted_device)
            return {"intent": "live_device_status", "device": extracted_device, "flow_name": None, "route": "local_python"}

    # 3. Dynamic semantic router — KB document keyword/device match
    #    Only fires when query has NO operational words (i.e. clearly a knowledge lookup)
    _operational_words = {
        "run", "trigger", "execute", "collect", "start", "perform",
        "show", "display", "compare", "diff", "history", "logs", "log",
        "backup", "backups", "healthcheck", "healthchecks", "alarm", "alarms",
        "incident", "incidents", "last", "latest", "drift", "audit",
        "view", "get", "print", "share",
    }
    try:
        registry = vector_sync.load_registry()
        words = set(re.findall(r"\b[a-zA-Z0-9_-]+\b", query_lower))
        if not (words & _operational_words):
            for filename, meta in registry.items():
                if (words & set(meta.get("devices", []))) or (words & set(meta.get("keywords", []))):
                    logger.info("Dynamic router: KB match on %s → vector_db", filename)
                    return {"intent": "general_chat", "device": None, "flow_name": None, "route": "vector_db"}
    except Exception as exc:
        logger.error("Dynamic router error: %s", exc)

    # ------------------------------------------------------------------
    # LLM CLASSIFICATION
    # ------------------------------------------------------------------
    system_prompt = config_loader.get_prompt("intent_classifier")
    intent = "general_chat"
    device = None
    flow_name = None
    route = "local_ollama"

    # Give the classifier a little conversational memory for ambiguous
    # follow-ups ("how many are up?") that the deterministic fast-path
    # carry-forward above doesn't cover — short and truncated, this is still
    # the cheap/fast classification step, not full context retrieval.
    history_context = ""
    if history and len(history) > 1:
        recent = history[:-1][-2:]
        lines = []
        for h in recent:
            h_role = h.get("role") if isinstance(h, dict) else getattr(h, "role", "")
            h_content = h.get("content") if isinstance(h, dict) else getattr(h, "content", "")
            if h_content:
                lines.append(f"{h_role}: {h_content[:200]}")
        if lines:
            history_context = "Recent conversation, for context only — classify the LAST message below:\n" + "\n".join(lines) + "\n\n"
    user_content = f"{history_context}{query}" if history_context else query

    try:
        # 120s was the old ceiling — classification uses a small, capped-output
        # model and should never legitimately need that long. A hang here means
        # the user waits for the full timeout just to get a wrong "general_chat"
        # fallback; 30s bounds the worst case without cutting off real (if
        # CPU-contended) classification calls.
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/chat",
                json={
                    "model": active_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    "stream": False,
                    "options": {"temperature": 0.0, "num_thread": OLLAMA_NUM_THREAD, "num_predict": 150},
                },
            )
            if resp.status_code == 200:
                raw = resp.json()["message"]["content"].strip()
                # Extract JSON block — model may wrap it in markdown
                m = re.search(r"\{[\s\S]*?\}", raw)
                if m:
                    parsed = json.loads(m.group(0))
                    intent    = parsed.get("intent", "general_chat")
                    device    = parsed.get("device")
                    flow_name = parsed.get("flow_name")
                    route     = parsed.get("route", "local_ollama")
                    # Normalise null-ish values the model sometimes returns as strings
                    if device    in ("null", "None", "", None, "none"): device    = None
                    if flow_name in ("null", "None", "", None, "none"): flow_name = None
                else:
                    logger.warning("LLM returned no parseable JSON. Falling back to general_chat.")
            else:
                logger.error("Ollama returned HTTP %s for intent classification", resp.status_code)
    except Exception as exc:
        logger.error("LLM intent classification failed: %s", exc)
        return {"intent": "general_chat", "device": None, "flow_name": None, "route": "local_ollama"}

    # ------------------------------------------------------------------
    # PYTHON DEVICE EXTRACTION BACKUP
    # ------------------------------------------------------------------
    # An IP that resolved to a real device (step 1 above) is unambiguous —
    # strictly more trustworthy than the LLM's own `device` field, which
    # sometimes echoes back the raw IP/text from the query instead of the
    # resolved hostname (e.g. "backup the configuration of 203.0.113.13" →
    # LLM returned device="203.0.113.13" instead of the matching hostname,
    # which then failed verification below even though the device was already
    # correctly identified). Prefer it. Note: this deliberately does NOT
    # extend to the weaker word/substring device matches from steps 2-3 —
    # those can match on a single shared word (e.g. bare "TOR23" partially
    # matching "demo-switch-01"), which is too weak a signal to override the
    # LLM's overall read of whether the query is even about that device.
    if extracted_device_from_ip:
        device = extracted_device_from_ip
    elif not device:
        device = _extract_device(query)
        if device:
            logger.info("Device extraction backup found: %s", device)

    # Verify the resolved device is real before trusting it — both the LLM's own
    # JSON output and the regex pattern-matcher above can produce a plausible-
    # looking but nonexistent/typo'd device name. Letting that sail into full
    # reasoning (and potentially live tool execution) wastes a slow LLM cycle
    # and, worse, can act against the wrong device. Only overrides when the
    # inventory fetch actually succeeded (can't verify otherwise). For
    # general_chat specifically, only override when the query itself is
    # clearly device-status-shaped (e.g. "is X up?") — the LLM sometimes
    # misclassifies exactly this pattern as general_chat while still
    # correctly extracting the device; a truly general question that
    # happens to have a spurious device match should proceed unblocked.
    _device_status_shaped = intent != "general_chat" or any(
        re.search(r'\b' + w + r'\b', query_lower) for w in ("up", "down", "reachable", "unreachable", "status", "online", "offline")
    )
    if device and devices_list and _device_status_shaped:
        real_hit = next((d.get("hostname") for d in devices_list if d.get("hostname", "").lower() == device.lower()), None)
        if real_hit:
            device = real_hit
        elif query_names_own_platform and not is_operational:
            # The classifier extracted something matching a platform/model
            # pattern (e.g. "NE9000") as if it were an attempted specific
            # hostname, but real hostnames only ever contain it as a
            # substring (e.g. "demo-core-04") — exact-match fails.
            # Confirmed live: "share the BGP configuration for Huawei
            # NE9000" got classified show_config/device=NE9000 and hard-
            # failed "Device Not Found" for what's clearly a platform-level
            # documentation question, not a mistyped device name. Read-only/
            # non-operational queries shaped like this should fall through
            # to general_chat (KB-backed) instead of a hard stop — only
            # genuinely operational commands (run/execute/...) still need
            # the strict unregistered_device rejection below, since acting
            # on a wrong device is unsafe in a way answering a doc question
            # about the wrong platform name isn't.
            logger.info(f"Platform-name device guess '{device}' not a real hostname — falling through to general_chat instead of hard-failing.")
            intent = "general_chat"
            device = None
        else:
            logger.info(f"Instant override: unregistered_device (LLM/pattern guess: {device})")
            return {"intent": "unregistered_device", "device": device, "flow_name": None, "route": "local_python"}

    logger.info("Intent classified → intent=%s device=%s route=%s", intent, device, route)
    return {"intent": intent, "device": device, "flow_name": flow_name, "route": route}
