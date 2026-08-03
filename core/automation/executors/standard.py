import os
import re
import time
import asyncio
from typing import Dict, Any
from executors.base import (
    ExecutionContext,
    resolve_devices_for_node,
    push_config_to_device,
    collect_from_device,
    CollectionType,
    DEVICE_USER,
    DEVICE_PASS,
    logger
)
from executors.ansible_runner import run_ansible_playbook


async def _run_check_via_ansible(node_id: str, node_data: dict, node_targeted_devices: list, ctx: ExecutionContext, phase: str) -> tuple[dict, bool]:
    """Shared by execute_pre_check/execute_post_check's Ansible branch.
    Returns (step_data, node_failed) in the same shape the CLI-based path
    already produces, so downstream code (auto-rollback lookup, UI
    rendering) doesn't need to know which mode ran. Persistence already
    happened server-side in backend's save_automation_run() for every
    run-command call the playbook made — this function doesn't duplicate
    that via git_manager, it only surfaces the outcome."""
    flow_name = node_data.get("ansibleFlowName")
    extra_vars = node_data.get("ansibleExtraVars") or {}
    hostnames = [d["hostname"] for d in node_targeted_devices]

    if not flow_name:
        ctx.log_step(f"{phase}-check (Ansible mode) has no flow selected — nothing to run.")
        return {}, True

    ctx.log_step(f"Running Ansible flow '{flow_name}' for {phase}-check against {len(hostnames)} host(s)...")
    result = await run_ansible_playbook(flow_name, hostnames, extra_vars)

    step_data = {}
    node_failed = result["status"] != "success"
    for hostname in hostnames:
        host_result = result["hosts"].get(hostname)
        if host_result is None:
            # Host wasn't in Ansible's stats at all — usually means it
            # fell outside the --limit match (e.g. not in this flow's
            # vendor group) rather than a genuine failure; surface it
            # plainly instead of silently omitting the device.
            step_data[hostname] = {"status": "skipped", "error": "Host not matched by this flow's inventory group"}
            continue
        status = host_result["status"]
        step_data[hostname] = {"status": status, "id": None, "error": host_result.get("last_message") if status == "failed" else None}
        if status == "failed":
            ctx.failures.append({"device": hostname, "error": f"{phase.capitalize()}-Check (Ansible): {host_result.get('last_message')}"})
            node_failed = True

    if result["status"] != "success" and result.get("error"):
        ctx.log_step(f"Ansible flow '{flow_name}' failed to run at all: {result['error']}")

    return step_data, node_failed

def generate_rollback_script(commands_text: str, vendor: str) -> str:
    lines = commands_text.splitlines()
    rollback_lines = []
    
    is_huawei = "huawei" in vendor.lower() or "vrp" in vendor.lower()
    undo_prefix = "undo " if is_huawei else "no "
    
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("!"):
            continue
            
        indent = line[:len(line) - len(stripped)]
        
        if stripped.lower().startswith("interface ") or stripped.lower().startswith("int ") or stripped.lower().startswith("router "):
            # Interface or router block header stays the same
            rollback_lines.append(line)
        else:
            if stripped.startswith("no ") or stripped.startswith("undo "):
                rollback_lines.append(indent + stripped[3 if stripped.startswith("no ") else 5:])
            elif stripped.startswith("ip address") and not is_huawei:
                rollback_lines.append(indent + "no ip address")
            elif stripped.startswith("ip address") and is_huawei:
                rollback_lines.append(indent + "undo ip address")
            elif stripped.startswith("ospf cost") and not is_huawei:
                rollback_lines.append(indent + "no ospf cost")
            elif stripped.startswith("ospf cost") and is_huawei:
                rollback_lines.append(indent + "undo ospf cost")
            else:
                rollback_lines.append(indent + undo_prefix + stripped)
                
    return "\n".join(rollback_lines)

async def execute_device_select(node_id: str, node_data: dict, ctx: ExecutionContext):
    node_targeted_devices, _ = resolve_devices_for_node(node_id, ctx.nodes, ctx.edges, ctx.devices)
    node_device_names = [d["hostname"] for d in node_targeted_devices]
    ctx.step_results[node_id] = {"status": "success", "data": {"targets": node_device_names}}
    ctx.update_node_run_status(node_id, "success")

async def execute_pre_check(node_id: str, node_data: dict, ctx: ExecutionContext):
    node_targeted_devices, node_custom_creds = resolve_devices_for_node(node_id, ctx.nodes, ctx.edges, ctx.devices)

    check_mode = node_data.get("checkMode") or ("yaml" if node_data.get("useYamlCommands") else "custom")
    if check_mode == "ansible":
        step_data, node_failed = await _run_check_via_ansible(node_id, node_data, node_targeted_devices, ctx, phase="pre")
        node_status = "failed" if node_failed else "success"
        ctx.step_results[node_id] = {"status": node_status, "data": step_data}
        ctx.update_node_run_status(node_id, node_status)
        if node_status == "failed":
            raise Exception("Pre-Check validation diagnostic failed.")
        return

    cmds_source = node_data.get("yamlScriptPath") if node_data.get("useYamlCommands") else None
    commands_text = node_data.get("commandsText")

    async def run_pre_hc(dev):
        dev_with_creds = {
            **dev,
            "username": node_custom_creds["username"] if node_custom_creds else (DEVICE_USER or dev.get("username", "")),
            "password": node_custom_creds["password"] if node_custom_creds else (DEVICE_PASS or dev.get("password", "")),
        }
        
        if cmds_source:
            dev_with_creds["selected_commands_source"] = cmds_source
        
        t0 = time.time()
        try:
            if not cmds_source and commands_text:
                os.makedirs("/app/commands", exist_ok=True)
                temp_path = f"/app/commands/temp_precheck_{node_id}.txt"
                with open(temp_path, "w", encoding="utf-8") as f:
                    f.write(commands_text)
                dev_with_creds["selected_commands_source"] = temp_path
                
            res = await collect_from_device(ctx.jump_pool, dev_with_creds, command_type="healthcheck")
            duration = time.time() - t0
            output_text = res["output"]
            error_tags = ("[JUMP ERROR]", "[JUMP CONNECT FAIL]", "[ERROR]", "[TIMEOUT]", "[AUTH FAIL]")
            status = "failed" if any(output_text.startswith(tag) for tag in error_tags) else "success"
            error_msg = output_text[:300] if status == "failed" else None
            
            backup_id = None
            if ctx.git_manager and status == "success":
                git_res = ctx.git_manager.save_config(
                    device_id=dev["id"],
                    device_name=dev["hostname"],
                    config_text=output_text,
                    status=status,
                    error_msg=error_msg,
                    collection_type=CollectionType.HEALTHCHECK,
                    duration=duration
                )
                backup_id = git_res.get("id")
                
            return {"device": dev["hostname"], "status": status, "id": backup_id, "error": error_msg}
        except Exception as e:
            return {"device": dev["hostname"], "status": "failed", "error": str(e)}

    ctx.log_step("Executing concurrent Precheck diagnostics...")
    hc_results = await asyncio.gather(*(run_pre_hc(d) for d in node_targeted_devices))
    
    step_data = {}
    node_failed = False
    for r in hc_results:
        step_data[r["device"]] = r
        if r["status"] == "failed":
            ctx.failures.append({"device": r["device"], "error": f"Pre-Check: {r['error']}"})
            node_failed = True
        elif r["id"]:
            ctx.pre_healthcheck_ids[r["device"]] = r["id"]
            
    node_status = "failed" if node_failed else "success"
    ctx.step_results[node_id] = {"status": node_status, "data": step_data}
    ctx.update_node_run_status(node_id, node_status)
    if node_status == "failed":
        raise Exception("Pre-Check validation diagnostic failed.")

async def execute_config_deploy(node_id: str, node_data: dict, ctx: ExecutionContext):
    deploy_mode = node_data.get("deployMode", "cli")
    commands_text = node_data.get("commandsText", "")
    variables = node_data.get("variables") or {}

    node_targeted_devices, node_custom_creds = resolve_devices_for_node(node_id, ctx.nodes, ctx.edges, ctx.devices)

    # 1. Pre-Execution Backup Check — applies to both deploy modes; a
    # write playbook reaches the network exactly the same way CLI-mode
    # does (via backend's push-config gateway), so the same staleness
    # gate must hold regardless of which mode pushed the config.
    if ctx.git_manager:
        for dev in node_targeted_devices:
            hostname = dev["hostname"]
            try:
                from git_manager import CollectionType
                backups = ctx.git_manager.get_device_collections(hostname, CollectionType.BACKUP, limit=1)
                if not backups or backups[0]["status"] != "success":
                    raise Exception("No successful config backup found in Git repository.")
                
                from datetime import datetime, timezone
                latest = backups[0]
                collected_str = latest["collected_at"]
                
                dt_str = collected_str.replace("Z", "+00:00")
                dt = datetime.fromisoformat(dt_str)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                
                age_seconds = (datetime.now(timezone.utc) - dt).total_seconds()
                age_hours = age_seconds / 3600.0
                
                if age_hours > 6.0:
                    raise Exception(f"Backup is stale. Last backup was {age_hours:.1f} hours ago (maximum allowed: 6 hours).")
                
                ctx.log_step(f"Pre-Execution Backup Check: SUCCESS for {hostname} (last backup was {age_hours:.1f} hours ago)")
            except Exception as e:
                ctx.failures.append({"device": hostname, "error": f"Pre-Execution Backup Check Failed: {str(e)}"})
                ctx.log_step(f"ERROR: Pre-Execution Backup Check failed for {hostname}: {str(e)}")
                ctx.update_node_run_status(node_id, "failed")
                raise Exception(f"Pre-Execution Backup Check failed for {hostname}: {str(e)}")

    if deploy_mode == "ansible":
        flow_name = node_data.get("ansibleFlowName")
        extra_vars = node_data.get("ansibleExtraVars") or {}
        hostnames = [d["hostname"] for d in node_targeted_devices]

        if not flow_name:
            ctx.log_step("Config Deploy (Ansible mode) has no flow selected — nothing to run.")
            ctx.step_results[node_id] = {"status": "failed", "data": {}, "rollback_scripts": {}, "deploy_mode": "ansible"}
            ctx.update_node_run_status(node_id, "failed")
            raise Exception("Config Deploy (Ansible mode) has no flow selected.")

        ctx.log_step(f"Deploying via Ansible flow '{flow_name}' to {len(hostnames)} host(s)...")
        result = await run_ansible_playbook(flow_name, hostnames, extra_vars)

        step_data = {}
        node_failed = result["status"] != "success"
        for hostname in hostnames:
            host_result = result["hosts"].get(hostname)
            if host_result is None:
                step_data[hostname] = {"status": "skipped", "error": "Host not matched by this flow's inventory group"}
                continue
            status = host_result["status"]
            step_data[hostname] = {"status": status, "error": host_result.get("last_message") if status == "failed" else None}
            if status == "failed":
                ctx.failures.append({"device": hostname, "error": f"Config Deploy (Ansible): {host_result.get('last_message')}"})
                node_failed = True

        if result["status"] != "success" and result.get("error"):
            ctx.log_step(f"Ansible flow '{flow_name}' failed to run at all: {result['error']}")

        node_status = "failed" if node_failed else "success"
        ctx.step_results[node_id] = {
            "status": node_status,
            "data": step_data,
            # No CLI rollback script exists for an Ansible-mode deploy —
            # execute_post_check's auto-rollback branch checks this flag
            # and skips the rollback attempt instead of finding an empty
            # script and silently doing nothing.
            "rollback_scripts": {},
            "deploy_mode": "ansible",
        }
        ctx.update_node_run_status(node_id, node_status)
        if node_status == "failed":
            raise Exception("Configuration deployment execution failed on targets (Ansible).")
        return

    # Replace double brackets {{ variables }}
    interpolated_text = commands_text
    for var_name, var_val in variables.items():
        pattern = r"\{\{\s*" + re.escape(var_name) + r"\s*\}\}"
        interpolated_text = re.sub(pattern, str(var_val), interpolated_text)

    # 2. Generate Rollback Script and save it in step results
    rollback_scripts = {}
    for dev in node_targeted_devices:
        vendor = dev.get("vendor", "cisco")
        rollback_script = generate_rollback_script(interpolated_text, vendor)
        rollback_scripts[dev["hostname"]] = rollback_script
        ctx.log_step(f"Generated Rollback Script for {dev['hostname']}:\n{rollback_script}")

    async def push_single(dev):
        res = await push_config_to_device(ctx.jump_pool, dev, interpolated_text, node_custom_creds)
        return {"device": dev["hostname"], **res}

    ctx.log_step(f"Pushing configs configuration to {len(node_targeted_devices)} routers...")
    push_results = await asyncio.gather(*(push_single(d) for d in node_targeted_devices))
    
    step_data = {}
    node_failed = False
    for r in push_results:
        step_data[r["device"]] = {
            "status": r["status"],
            "duration": r["duration"],
            "console_log": r["session_log"],
            "error": r.get("error")
        }
        if r["status"] == "failed":
            ctx.failures.append({"device": r["device"], "error": f"Config Deploy: {r.get('error')}"})
            node_failed = True
            
    node_status = "failed" if node_failed else "success"
    ctx.step_results[node_id] = {
        "status": node_status,
        "data": step_data,
        "rollback_scripts": rollback_scripts,
        "deploy_mode": "cli"
    }
    ctx.update_node_run_status(node_id, node_status)
    if node_status == "failed":
        raise Exception("Configuration deployment execution failed on targets.")

async def execute_post_check(node_id: str, node_data: dict, ctx: ExecutionContext):
    auto_rollback = node_data.get("autoRollback") != False
    node_targeted_devices, node_custom_creds = resolve_devices_for_node(node_id, ctx.nodes, ctx.edges, ctx.devices)

    check_mode = node_data.get("checkMode") or ("yaml" if node_data.get("useYamlCommands") else "custom")
    if check_mode == "ansible":
        step_data, node_failed = await _run_check_via_ansible(node_id, node_data, node_targeted_devices, ctx, phase="post")
    else:
        cmds_source = node_data.get("yamlScriptPath") if node_data.get("useYamlCommands") else None
        commands_text = node_data.get("commandsText")
        step_data, node_failed = await _run_check_via_cli(node_id, node_data, node_targeted_devices, node_custom_creds, ctx, cmds_source, commands_text, phase="post")

    node_status = "failed" if node_failed else "success"
    ctx.step_results[node_id] = {"status": node_status, "data": step_data}
    ctx.update_node_run_status(node_id, node_status)

    # Check for Rollback trigger — same for either check mode.
    if node_status == "failed" and auto_rollback:
        ctx.log_step("Post-Check diagnostics validation failed. Auto-rollback triggered!")

        deploy_node = next((n for n in ctx.nodes if n["type"] == "configDeployNode"), None)
        if deploy_node and deploy_node["id"] in ctx.step_results:
            deploy_result = ctx.step_results[deploy_node["id"]]
            rollback_scripts = deploy_result.get("rollback_scripts", {})

            if deploy_result.get("deploy_mode") == "ansible":
                ctx.log_step(
                    "Deploy step ran via Ansible — no CLI rollback script was generated for this mode "
                    "(known limitation, see executors/standard.py). Auto-rollback skipped; revert manually."
                )
            else:
                async def rollback_single(dev):
                    hostname = dev["hostname"]
                    script = rollback_scripts.get(hostname)
                    if not script:
                        ctx.log_step(f"No rollback script found for {hostname}")
                        return {"device": hostname, "status": "failed", "error": "No rollback script found"}

                    ctx.log_step(f"Deploying Rollback Config to {hostname}...")
                    res = await push_config_to_device(ctx.jump_pool, dev, script, node_custom_creds)
                    return {"device": hostname, **res}

                rollback_results = await asyncio.gather(*(rollback_single(d) for d in node_targeted_devices))
                for r in rollback_results:
                    if r["status"] == "success":
                        ctx.log_step(f"SUCCESS: Rollback configuration deployed to {r['device']}.")
                    else:
                        ctx.log_step(f"ERROR: Rollback failed on {r['device']}: {r.get('error')}")


async def _run_check_via_cli(node_id: str, node_data: dict, node_targeted_devices: list, node_custom_creds, ctx: ExecutionContext, cmds_source, commands_text, phase: str) -> tuple[dict, bool]:
    """The pre-existing CLI-scrape check path, factored out unchanged so
    execute_post_check can share it with the Ansible branch above."""
    async def run_post_hc(dev):
        dev_with_creds = {
            **dev,
            "username": node_custom_creds["username"] if node_custom_creds else (DEVICE_USER or dev.get("username", "")),
            "password": node_custom_creds["password"] if node_custom_creds else (DEVICE_PASS or dev.get("password", "")),
        }
        
        if cmds_source:
            dev_with_creds["selected_commands_source"] = cmds_source
        
        t0 = time.time()
        try:
            if not cmds_source and commands_text:
                os.makedirs("/app/commands", exist_ok=True)
                temp_path = f"/app/commands/temp_postcheck_{node_id}.txt"
                with open(temp_path, "w", encoding="utf-8") as f:
                    f.write(commands_text)
                dev_with_creds["selected_commands_source"] = temp_path
                
            res = await collect_from_device(ctx.jump_pool, dev_with_creds, command_type="healthcheck")
            duration = time.time() - t0
            output_text = res["output"]
            error_tags = ("[JUMP ERROR]", "[JUMP CONNECT FAIL]", "[ERROR]", "[TIMEOUT]", "[AUTH FAIL]")
            status = "failed" if any(output_text.startswith(tag) for tag in error_tags) else "success"
            error_msg = output_text[:300] if status == "failed" else None
            
            backup_id = None
            if ctx.git_manager and status == "success":
                git_res = ctx.git_manager.save_config(
                    device_id=dev["id"],
                    device_name=dev["hostname"],
                    config_text=output_text,
                    status=status,
                    error_msg=error_msg,
                    collection_type=CollectionType.HEALTHCHECK,
                    duration=duration
                )
                backup_id = git_res.get("id")
                
            return {"device": dev["hostname"], "status": status, "id": backup_id, "error": error_msg}
        except Exception as e:
            return {"device": dev["hostname"], "status": "failed", "error": str(e)}

    ctx.log_step("Executing concurrent Postcheck diagnostics...")
    hc_results = await asyncio.gather(*(run_post_hc(d) for d in node_targeted_devices))
    
    step_data = {}
    node_failed = False
    for r in hc_results:
        step_data[r["device"]] = r
        if r["status"] == "failed":
            ctx.failures.append({"device": r["device"], "error": f"Post-Check: {r['error']}"})
            node_failed = True
        elif r["id"]:
            ctx.post_healthcheck_ids[r["device"]] = r["id"]
            
    return step_data, node_failed

async def execute_git_commit(node_id: str, node_data: dict, ctx: ExecutionContext):
    step_data = {}
    node_status = "success"
    
    node_targeted_devices, _ = resolve_devices_for_node(node_id, ctx.nodes, ctx.edges, ctx.devices)
    
    for dev in node_targeted_devices:
        name = dev["hostname"]
        pre_id = ctx.pre_healthcheck_ids.get(name)
        post_id = ctx.post_healthcheck_ids.get(name)
        
        if not pre_id or not post_id:
            step_data[name] = {"status": "success", "warnings": ["Missing pre or post run ID - Skipping diff compare"]}
            continue
            
        compare_res = ctx.git_manager.compare_configs(name, pre_id, post_id, CollectionType.HEALTHCHECK)
        
        if "error" in compare_res:
            step_data[name] = {"status": "success", "warnings": [compare_res["error"]]}
            continue
            
        step_data[name] = {
            "status": "success",
            "diff": compare_res.get("diff"),
            "lines_added": compare_res.get("lines_added"),
            "lines_removed": compare_res.get("lines_removed")
        }
        
    ctx.step_results[node_id] = {"status": node_status, "data": step_data}
    ctx.update_node_run_status(node_id, node_status)
    ctx.log_step("Change audits committed to Git history repository timeline.")

async def execute_notification(node_id: str, node_data: dict, ctx: ExecutionContext):
    ctx.step_results[node_id] = {"status": "success"}
    ctx.update_node_run_status(node_id, "success")
