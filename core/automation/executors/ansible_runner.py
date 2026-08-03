"""Runs an Ansible playbook as a subprocess and parses its structured
per-host results. This module never touches a device directly — every task
inside the playbooks it runs calls back into NETAct_backend's sanitized
gateway (POST /devices/{id}/run-command or /push-config); this file's only
job is invoking the ansible-playbook process and making its outcome legible
to the visual flow engine's existing per-device step_data shape."""
import os
import json
import asyncio
import logging
import tempfile

logger = logging.getLogger("automation.executors.ansible")

_HERE = os.path.dirname(os.path.abspath(__file__))
ANSIBLE_DIR = os.path.join(os.path.dirname(_HERE), "ansible")
ANSIBLE_PLAYBOOKS_DIR = os.path.join(ANSIBLE_DIR, "playbooks")


async def run_ansible_playbook(flow_name: str, hosts: list, extra_vars: dict = None) -> dict:
    """Runs playbooks/<flow_name> limited to `hosts` (must match hostnames
    from inventory/dynamic_inventory.py, i.e. the same device.hostname
    values everywhere else in NETAct). Returns:
        {
          "status": "success" | "failed",
          "returncode": int,
          "hosts": {hostname: {"status": "success"|"failed", "stats": {...}, "last_message": str|None}},
          "raw_stdout": str, "raw_stderr": str,
        }
    """
    playbook_path = os.path.join(ANSIBLE_PLAYBOOKS_DIR, flow_name)
    if not os.path.isfile(playbook_path):
        return {"status": "failed", "error": f"Playbook '{flow_name}' not found", "hosts": {}, "raw_stdout": "", "raw_stderr": ""}
    if not hosts:
        return {"status": "failed", "error": "No target hosts resolved for this node", "hosts": {}, "raw_stdout": "", "raw_stderr": ""}

    # --limit as a comma-joined string breaks on hostnames containing
    # spaces or commas — confirmed this inventory has both (e.g. an
    # Excel-imported hostname like "Encoder DR TOR 9"). --limit @file reads
    # one pattern per line instead, sidestepping shell/pattern-parsing
    # ambiguity entirely regardless of what's in a hostname.
    limit_file = tempfile.NamedTemporaryFile(mode="w", suffix=".limit", delete=False, dir=ANSIBLE_DIR)
    try:
        limit_file.write("\n".join(hosts))
        limit_file.close()

        cmd = ["ansible-playbook", playbook_path, "--limit", f"@{limit_file.name}"]
        if extra_vars:
            cmd += ["-e", json.dumps(extra_vars)]

        env = {**os.environ, "ANSIBLE_STDOUT_CALLBACK": "json", "ANSIBLE_NOCOLOR": "1"}

        logger.info("Running ansible-playbook %s for hosts=%s", flow_name, hosts)
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=ANSIBLE_DIR, env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
    finally:
        try:
            os.remove(limit_file.name)
        except OSError:
            pass

    stdout_text = stdout.decode("utf-8", errors="replace")
    stderr_text = stderr.decode("utf-8", errors="replace")

    per_host = {}
    try:
        parsed = json.loads(stdout_text)
        # The top-level "stats" block is the authoritative per-host
        # pass/fail summary Ansible itself computes — simpler and more
        # reliable than reconstructing it from individual task results.
        for host, s in parsed.get("stats", {}).items():
            failed = s.get("failures", 0) > 0 or s.get("unreachable", 0) > 0
            per_host[host] = {"status": "failed" if failed else "success", "stats": s, "last_message": None}
        # Best-effort: attach each host's most recent task message/result
        # as a human-readable summary (not required for status, just context).
        for play in parsed.get("plays", []):
            for task in play.get("tasks", []):
                for host, result in task.get("hosts", {}).items():
                    if host not in per_host:
                        continue
                    msg = result.get("msg")
                    if msg is None and isinstance(result.get("json"), dict):
                        msg = result["json"].get("output") or result["json"].get("detail")
                    if msg is not None:
                        per_host[host]["last_message"] = msg if isinstance(msg, str) else json.dumps(msg)[:2000]
    except Exception as e:
        logger.warning("Failed to parse ansible-playbook JSON output for %s: %s", flow_name, e)

    return {
        "status": "success" if proc.returncode == 0 else "failed",
        "returncode": proc.returncode,
        "hosts": per_host,
        "raw_stdout": stdout_text[-5000:],
        "raw_stderr": stderr_text[-2000:] if proc.returncode != 0 else "",
    }
