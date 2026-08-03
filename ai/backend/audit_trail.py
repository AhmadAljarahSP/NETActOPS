import os
import json
import subprocess
import logging
from datetime import datetime

logger = logging.getLogger("audit_trail")

GIT_REPO_PATH = os.getenv("GIT_REPO_PATH", "/git/repo")

def write_audit_log(thread_id: str, action: str, data: dict):
    """Appends an audit log entry for a specific session thread and commits it to Git."""
    if not os.path.exists(GIT_REPO_PATH):
        logger.debug("Git repository path %s does not exist; skipping git audit logging", GIT_REPO_PATH)
        # Fall back to local file logging if git folder isn't mounted on host debug
        local_audit_dir = os.path.join(os.path.dirname(__file__), "db", "audit_logs")
        os.makedirs(local_audit_dir, exist_ok=True)
        log_file = os.path.join(local_audit_dir, f"session_{thread_id}.jsonl")
        _write_file(log_file, action, data)
        return

    audit_dir = os.path.join(GIT_REPO_PATH, "audit_logs")
    os.makedirs(audit_dir, exist_ok=True)
    log_file = os.path.join(audit_dir, f"session_{thread_id}.jsonl")
    
    _write_file(log_file, action, data)
    
    # Run git commits inside the repository
    try:
        # Check if user email is set, if not set defaults
        subprocess.run(["git", "config", "user.name"], cwd=GIT_REPO_PATH, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        # If it doesn't return successfully or user is empty, we set local configs
        subprocess.run(["git", "config", "user.name", "NETAct Copilot Agent"], cwd=GIT_REPO_PATH, check=False)
        subprocess.run(["git", "config", "user.email", "copilot@netact.local"], cwd=GIT_REPO_PATH, check=False)
        
        # Add and commit the file
        rel_path = f"audit_logs/session_{thread_id}.jsonl"
        subprocess.run(["git", "add", rel_path], cwd=GIT_REPO_PATH, check=False)
        subprocess.run(["git", "commit", "-m", f"GAIT Audit: Thread {thread_id} - {action}"], cwd=GIT_REPO_PATH, check=False)
    except Exception as e:
        logger.error("Git commit failed for session audit: %s", e)

def _write_file(file_path: str, action: str, data: dict):
    """Helper to write to jsonl file."""
    entry = {
        "timestamp": datetime.now().isoformat(),
        "action": action,
        "payload": data
    }
    try:
        with open(file_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        logger.error("Failed to write session audit entry: %s", e)
