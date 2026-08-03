import os
import io
import re
import sys
import json
import time
import asyncio
import asyncssh
import logging
import httpx
import yaml
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Request, Header, UploadFile, File, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Set up logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    force=True,
)
logger = logging.getLogger("automation")

# Adjust sys.path to allow imports from /app (which has shared files from backend)
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

# Shared imports
try:
    from async_jump_transport import AsyncJumpTransport
    from collector import collect_from_device, get_vendor_config, read_until_prompt, clean_output
    from git_manager import GitConfigManager, CollectionType
    logger.info("Shared modules imported successfully")
except ImportError as e:
    logger.error("Could not import shared modules: %s. Using mocks.", e)
    # Define fallback mocks if shared modules are missing
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

# Environment Variables
JUMP_HOST = os.getenv("JUMP_HOST", "")
JUMP_USER = os.getenv("JUMP_USER", "")
JUMP_PASS = os.getenv("JUMP_PASSWORD", "")
DEVICE_USER = os.getenv("DEVICE_USER", "")
DEVICE_PASS = os.getenv("DEVICE_PASS", "")
APP_PASSWORD = os.getenv("APP_PASSWORD")

# Git config & base paths
GIT_REPO_PATH = os.getenv("GIT_REPO_PATH", "/git/repo")
FLOWS_DIR = os.path.join(GIT_REPO_PATH, "automation", "flows")
RUNS_DIR = os.path.join(GIT_REPO_PATH, "automation", "runs")

# In-memory inventory registry & transport pool
devices: dict = {}
next_device_id = 1
jump_pool = None
git_manager = None

# Tracks in-flight /run-flow asyncio.Tasks by task_id so POST
# /executions/{task_id}/cancel can actually cancel them. Entries are removed
# via a done-callback once a task finishes (success, failure, or cancellation).
_running_tasks: dict[str, "asyncio.Task"] = {}

app = FastAPI(
    title="NETAct Automation Visual Engine",
    version="1.1",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth Middleware
async def verify_api_key(request: Request, x_api_key: str = Header(None)):
    path = request.url.path.rstrip("/")
    if path.endswith("/health"):
        return
    if APP_PASSWORD and x_api_key != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid API Key")

# ---------------------------------------------------------------------------
# Device inventory loader
# ---------------------------------------------------------------------------
DEVICES_DIR = "/app/devices"

def load_initial_devices():
    import glob
    import yaml
    global next_device_id

    devices.clear()
    next_device_id = 1
    logger.info("load_initial_devices() START")

    yaml_files = []
    if os.path.exists(DEVICES_DIR):
        yaml_files = glob.glob(os.path.join(DEVICES_DIR, "*.yaml")) + glob.glob(os.path.join(DEVICES_DIR, "*.yml"))
    
    if not yaml_files:
        yaml_files = ["devices.yaml"] if os.path.exists("devices.yaml") else []

    for yaml_path in yaml_files:
        try:
            with open(yaml_path, "r") as f:
                data = yaml.safe_load(f)

            if data is None or not isinstance(data, dict):
                continue

            groups = data.get("groups") or {}
            jump_srv = data.get("jump_server") or {}
            dev_list = data.get("devices") or []

            for i, device in enumerate(dev_list):
                if not isinstance(device, dict):
                    continue

                device_id = next_device_id
                group_name = device.get("group")
                
                # Inherit from group config
                if group_name and group_name in groups:
                    grp = groups[group_name]
                    if isinstance(grp, dict):
                        for key in ["vendor", "connection", "username", "password",
                                    "port", "commands_source", "protocol", "device_type"]:
                            if key in grp and key not in device:
                                device[key] = grp[key]

                hostname = device.get("hostname") or device.get("ip") or f"device-{device_id}"
                ip_address = device.get("ip") or device.get("ip_address") or ""
                protocol = device.get("connection") or device.get("protocol") or "ssh"
                port = device.get("port")
                if port is None:
                    port = 23 if protocol.lower() == "telnet" else 22
                
                try:
                    port = int(port)
                except:
                    port = 23 if protocol.lower() == "telnet" else 22

                entry = {
                    "id": device_id,
                    "hostname": hostname,
                    "ip_address": ip_address,
                    "device_type": device.get("device_type", "router"),
                    "vendor": device.get("vendor", "cisco"),
                    "protocol": protocol,
                    "port": port,
                    "commands_source": device.get("commands_source"),
                    "jump_server": jump_srv,
                    "group": group_name or "unknown",
                    "group_file": os.path.splitext(os.path.basename(yaml_path))[0],
                }
                
                if isinstance(entry["commands_source"], list):
                    first = entry["commands_source"][0]
                    entry["selected_commands_source"] = first.get("path") if isinstance(first, dict) else first
                else:
                    entry["selected_commands_source"] = entry["commands_source"]

                devices[device_id] = entry
                next_device_id += 1
        except Exception as e:
            logger.error("Error reading file %s: %s", yaml_path, e)

# ---------------------------------------------------------------------------
# App Lifetime events
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup_event():
    global jump_pool, git_manager
    logger.info("NETAct Automation service starting...")
    
    # Initialize workspace directories
    os.makedirs(FLOWS_DIR, exist_ok=True)
    os.makedirs(RUNS_DIR, exist_ok=True)

    # Initialize Git Manager
    try:
        git_manager = GitConfigManager(GIT_REPO_PATH)
        logger.info("GitConfigManager initialized successfully")
    except Exception as e:
        logger.error("Failed to initialize GitConfigManager: %s", e)

    # Initialize SSH tunnel connection pool
    try:
        jump_pool = AsyncJumpTransport(host=JUMP_HOST, username=JUMP_USER, password=JUMP_PASS)
        logger.info("SSH tunnel transport pool ready on %s", JUMP_HOST)
    except Exception as e:
        logger.error("Failed to create SSH jump pool: %s", e)

    # Load initial inventory
    load_initial_devices()

@app.on_event("shutdown")
async def shutdown_event():
    global jump_pool
    if jump_pool:
        logger.info("Closing jump server SSH transport pool...")
        await jump_pool.close()

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "NETAct_Automation",
        "git_manager": git_manager is not None,
        "jump_pool": jump_pool is not None,
        "devices_loaded": len(devices),
    }

# Workflow Templates REST CRUD
class FlowNode(BaseModel):
    id: str
    type: str
    data: Optional[Dict[str, Any]] = None
    position: Optional[Dict[str, float]] = None

class FlowEdge(BaseModel):
    id: str
    source: str
    target: str

class FlowTemplate(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = ""
    nodes: List[FlowNode]
    edges: List[FlowEdge]

@app.get("/flows")
def list_flows():
    flows = []
    for file in os.listdir(FLOWS_DIR):
        if file.endswith(".json"):
            try:
                with open(os.path.join(FLOWS_DIR, file), "r", encoding="utf-8") as f:
                    flows.append(json.load(f))
            except Exception as e:
                logger.error("Error reading workflow file %s: %s", file, e)
    return flows

@app.get("/flows/{flow_id}")
def get_flow(flow_id: str):
    file_path = os.path.join(FLOWS_DIR, f"{flow_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Workflow template not found")
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/flows")
def save_flow(flow: FlowTemplate):
    flow_id = flow.id
    if not flow_id:
        flow_id = "flow_" + datetime.now().strftime("%Y%m%d_%H%M%S")
    file_path = os.path.join(FLOWS_DIR, f"{flow_id}.json")
    try:
        flow_dict = flow.dict()
        flow_dict["id"] = flow_id
        flow_dict["updated_at"] = datetime.now().isoformat()
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(flow_dict, f, indent=2)
        return {"status": "success", "flow_id": flow_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/flows/{flow_id}")
def delete_flow(flow_id: str):
    file_path = os.path.join(FLOWS_DIR, f"{flow_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Workflow template not found")
    try:
        os.remove(file_path)
        return {"status": "success", "message": f"Deleted workflow {flow_id}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Workflow Execution History REST
@app.get("/executions")
def list_executions():
    runs = []
    for file in os.listdir(RUNS_DIR):
        if file.endswith(".json"):
            try:
                with open(os.path.join(RUNS_DIR, file), "r", encoding="utf-8") as f:
                    data = json.load(f)
                    runs.append({
                        "task_id": data.get("task_id"),
                        "flow_name": data.get("flow_name"),
                        "status": data.get("status"),
                        "started_at": data.get("started_at"),
                        "completed_at": data.get("completed_at"),
                        "devices_count": len(data.get("devices", [])),
                        "devices": data.get("devices", []),
                    })
            except Exception as e:
                pass
    runs.sort(key=lambda x: x.get("started_at", ""), reverse=True)
    return runs

@app.get("/executions/{task_id}")
def get_execution(task_id: str):
    file_path = os.path.join(RUNS_DIR, f"{task_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Workflow execution not found")
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ---------------------------------------------------------------------------
# Node Resolution & SSH Helpers imported from executors package
# ---------------------------------------------------------------------------
from executors.base import (
    push_config_to_device,
    send_teams_notification,
    find_upstream_device_select_node,
    resolve_devices_for_node
)

class RunWorkflowRequest(BaseModel):
    name: str
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]

async def run_flow_background(task_id: str, flow_name: str, nodes: List[dict], edges: List[dict]):
    logger.info("Starting ReactFlow execution task: %s", task_id)
    
    t_start = time.time()
    started_at_str = datetime.now(timezone.utc).isoformat()
    
    # Prepare logs
    run_log = []
    device_names = []
    step_results = {}
    
    # Save function
    def save_state(status="running", completed_at=None):
        # Update node status in saved execution runs
        run_state = {
            "task_id": task_id,
            "flow_name": flow_name,
            "status": status,
            "started_at": started_at_str,
            "completed_at": completed_at,
            "devices": device_names,
            "logs": run_log,
            "steps": step_results,
            "nodes": nodes,
            "edges": edges
        }
        try:
            with open(os.path.join(RUNS_DIR, f"{task_id}.json"), "w", encoding="utf-8") as f:
                json.dump(run_state, f, indent=2)
        except Exception as e:
            logger.error("Error writing flow run state: %s", e)

    def update_node_run_status(node_id, status):
        for n in nodes:
            if n["id"] == node_id:
                n["data"]["status"] = status
        save_state()

    def log_step(msg):
        timestamp = datetime.now().strftime("%H:%M:%S")
        run_log.append({"timestamp": timestamp, "message": msg})
        logger.info("[%s] %s", task_id, msg)
        save_state()

    # Load inventory
    load_initial_devices()
    
    # Teams URL placeholder
    teams_webhook_url = None

    # Resolve notification nodes webhook URLs beforehand
    notify_node = next((n for n in nodes if n["type"] == "notificationNode"), None)
    if notify_node:
        teams_webhook_url = notify_node.get("data", {}).get("webhook")

    # Workflow Device Inventory Summary across all deviceSelectNodes
    all_targeted_devices = {}
    select_nodes = [n for n in nodes if n.get("type") == "deviceSelectNode"]
    if select_nodes:
        for s_node in select_nodes:
            devs, _ = resolve_devices_for_node(s_node["id"], nodes, edges, devices)
            for d in devs:
                all_targeted_devices[d["id"]] = d
        unique_targeted_devices = list(all_targeted_devices.values())
    else:
        unique_targeted_devices = list(devices.values())
        
    device_names = [d["hostname"] for d in unique_targeted_devices]
    log_step(f"Target select node resolved: {len(unique_targeted_devices)} devices ({', '.join(device_names)})")

    # Topological execution order
    adj = {n["id"]: [] for n in nodes}
    in_degree = {n["id"]: 0 for n in nodes}
    
    for edge in edges:
        u, v = edge["source"], edge["target"]
        if u in adj and v in adj:
            adj[u].append(v)
            in_degree[v] += 1
            
    queue = [n_id for n_id, deg in in_degree.items() if deg == 0]
    topo_order = []
    
    while queue:
        u = queue.pop(0)
        topo_order.append(u)
        for v in adj[u]:
            in_degree[v] -= 1
            if in_degree[v] == 0:
                queue.append(v)
                
    exec_nodes = [next(n for n in nodes if n["id"] == n_id) for n_id in topo_order]
    log_step(f"Execution order resolved: " + " -> ".join([n["type"] for n in exec_nodes]))
    
    failures = []
    flow_status = "success"

    pre_healthcheck_ids = {}
    post_healthcheck_ids = {}
    from executors import execute_node, ExecutionContext

    ctx = ExecutionContext(
        task_id=task_id,
        flow_name=flow_name,
        nodes=nodes,
        edges=edges,
        devices=devices,
        jump_pool=jump_pool,
        git_manager=git_manager,
        log_step=log_step,
        update_node_run_status=update_node_run_status,
        step_results=step_results,
        pre_healthcheck_ids=pre_healthcheck_ids,
        post_healthcheck_ids=post_healthcheck_ids,
        failures=failures
    )

    try:
        for node in exec_nodes:
            node_id = node["id"]
            node_type = node["type"]

            log_step(f"Executing step: {node_type} ({node_id})")
            update_node_run_status(node_id, "running")
            step_results[node_id] = {"status": "running"}

            try:
                await execute_node(node, ctx)
                if step_results[node_id].get("status") == "failed":
                    flow_status = "failed"
            except Exception as err:
                logger.error("Exception in ReactFlow executor node %s: %s", node_id, err, exc_info=True)
                step_results[node_id] = {"status": "failed", "error": str(err)}
                failures.append({"device": "global", "error": f"Node {node_type} error: {str(err)}"})
                flow_status = "failed"
                update_node_run_status(node_id, "failed")
                log_step(f"Step {node_type} execution crash: {str(err)}")

            step_results[node_id]["completed_at"] = datetime.now().isoformat()
            save_state(flow_status)
    except asyncio.CancelledError:
        # POST /executions/{task_id}/cancel landed while a node was mid-await.
        # Record it as cancelled (not left dangling as "running" forever) and
        # re-raise so the task genuinely finishes as cancelled.
        log_step("Workflow execution cancelled by user.")
        save_state("cancelled", datetime.now(timezone.utc).isoformat())
        raise

    t_duration = time.time() - t_start
    log_step(f"Visual pipeline executed in {t_duration:.2f} seconds. Status: {flow_status}")
    save_state(flow_status, datetime.now(timezone.utc).isoformat())
    
    if teams_webhook_url:
        log_step(f"Sending Teams notification webhook alert card...")
        await send_teams_notification(
            webhook_url=teams_webhook_url,
            flow_name=flow_name,
            task_id=task_id,
            status=flow_status,
            started=started_at_str,
            duration=t_duration,
            devices_list=device_names,
            failures=failures
        )

@app.post("/run-flow")
async def trigger_flow(req: RunWorkflowRequest):
    task_id = f"flow_run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    # Pre-populate execution state
    run_state = {
        "task_id": task_id,
        "flow_name": req.name,
        "status": "pending",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
        "devices": [],
        "logs": [{"timestamp": datetime.now().strftime("%H:%M:%S"), "message": "Workflow execution queued"}],
        "steps": {},
        "nodes": req.nodes,
        "edges": req.edges
    }
    
    with open(os.path.join(RUNS_DIR, f"{task_id}.json"), "w", encoding="utf-8") as f:
        json.dump(run_state, f, indent=2)

    # Start background task, tracked so it can be cancelled later via
    # POST /executions/{task_id}/cancel.
    task = asyncio.create_task(run_flow_background(task_id, req.name, req.nodes, req.edges))
    _running_tasks[task_id] = task
    task.add_done_callback(lambda t, tid=task_id: _running_tasks.pop(tid, None))

    return {"status": "success", "task_id": task_id}

@app.post("/executions/{task_id}/cancel")
async def cancel_execution(task_id: str):
    """Cancel an in-flight /run-flow execution. Only works while the task is
    still running — _running_tasks only holds entries for active runs, a
    done-callback removes them the moment a run finishes on its own."""
    task = _running_tasks.get(task_id)
    if task is None:
        file_path = os.path.join(RUNS_DIR, f"{task_id}.json")
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Workflow execution not found")
        raise HTTPException(status_code=409, detail="Workflow execution already finished")
    task.cancel()
    return {"status": "cancelling", "task_id": task_id}

# ---------------------------------------------------------------------------
# Ansible flows — list/inspect/syntax-check ONLY.
#
# Deliberately no execution endpoint exists here. Nothing in this file (or
# anywhere else in the automation service) ever invokes `ansible-playbook`
# against real inventory hosts. Adding a POST /ansible/flows/{name}/run
# endpoint later is a real, separate decision an operator should make
# explicitly — this only makes the flows visible and lets their YAML/module
# argspec be validated (--syntax-check opens zero connections to any host).
# ---------------------------------------------------------------------------
ANSIBLE_DIR = os.path.join(os.path.dirname(__file__), "ansible")
ANSIBLE_PLAYBOOKS_DIR = os.path.join(ANSIBLE_DIR, "playbooks")

def _safe_playbook_path(name: str) -> str:
    """Resolves a playbook name to a path strictly inside
    ANSIBLE_PLAYBOOKS_DIR, rejecting any attempt to escape it (../, absolute
    paths, symlink tricks) before it ever reaches the filesystem or a
    subprocess argument list."""
    if not re.fullmatch(r"[A-Za-z0-9_\-]+\.yml", name):
        raise HTTPException(status_code=400, detail="Invalid playbook name")
    candidate = os.path.realpath(os.path.join(ANSIBLE_PLAYBOOKS_DIR, name))
    playbooks_root = os.path.realpath(ANSIBLE_PLAYBOOKS_DIR)
    if os.path.commonpath([candidate, playbooks_root]) != playbooks_root:
        raise HTTPException(status_code=400, detail="Invalid playbook name")
    if not os.path.isfile(candidate):
        raise HTTPException(status_code=404, detail="Playbook not found")
    return candidate

# A playbook is only ever trusted as "read_only" (and therefore only ever
# offered in the frontend's Pre/PostCheck "Check Mode" dropdown, a UI slot
# operators will reasonably assume is always safe) if BOTH: it explicitly
# declares netact_playbook_mode: read_only in some play's vars, AND its raw
# content contains no reference to the push-config gateway. Declaring the
# tag alone is never sufficient — that would be trusting a label instead of
# verifying behavior, the same gap already closed elsewhere in this project
# (run-command doesn't trust a caller's claim a command is safe, it inspects
# the actual command text; the confidence-override doesn't trust the model's
# self-reported confidence, it checks actual retrieval scores).
_PUSH_CONFIG_MARKER = "push-config"

def _strip_yaml_comments(content: str) -> str:
    """Drops full-line '# ...' comments before the push-config marker
    check runs. Without this, a playbook's own explanatory comment about
    NOT calling push-config (exactly the kind of comment this project's
    README/playbooks write) trips the same substring match as an actual
    call, silently mislabeling a genuinely read_only flow as write."""
    return "\n".join(
        line for line in content.split("\n") if not line.lstrip().startswith("#")
    )

def _extract_playbook_mode(content: str) -> str:
    """Returns 'read_only' or 'write'. Defaults to 'write' (the safer,
    more restrictive assumption) if no play declares netact_playbook_mode
    at all, or if the file fails to parse as YAML."""
    try:
        docs = yaml.safe_load(content)
    except Exception:
        return "write"
    if not isinstance(docs, list):
        return "write"
    for play in docs:
        if isinstance(play, dict):
            mode = (play.get("vars") or {}).get("netact_playbook_mode")
            if mode in ("read_only", "write"):
                return mode
    return "write"

_REQUIRED_VAR_RE = re.compile(r"(\w+)\s+is\s+defined")

def _extract_required_vars(content: str) -> list:
    """Best-effort list of extra-vars a playbook expects the caller to
    supply, read from its own 'assert ... is defined' preflight checks
    (the convention every playbook in playbooks/ already follows for
    write actions — see push_bgp_config.yml / push_ospf_config.yml).
    Not a substitute for the playbook's own assert — this only drives
    the frontend's variable-entry form so users aren't guessing var
    names; the playbook still refuses to run without them regardless."""
    seen = []
    for match in _REQUIRED_VAR_RE.finditer(content):
        name = match.group(1)
        if name not in seen:
            seen.append(name)
    return seen

def _verify_playbook_mode_or_raise(content: str, declared_mode: str):
    """Rejects a read_only declaration that doesn't match reality. Never
    rejects a 'write' declaration — a write playbook doing more than it
    strictly needs to isn't a safety violation the way a read_only one
    silently being able to write would be."""
    if declared_mode == "read_only" and _PUSH_CONFIG_MARKER in _strip_yaml_comments(content):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Playbook declares netact_playbook_mode: read_only but its content "
                f"references '{_PUSH_CONFIG_MARKER}' — rejected. A read_only playbook "
                f"must never be able to reach the write gateway; fix the mode tag or "
                f"remove the push-config call."
            ),
        )

@app.get("/ansible/flows")
def list_ansible_flows():
    """Lists available Ansible playbooks (custom flows), each tagged with
    its verified mode. Read-only — just directory listing + YAML parsing,
    touches no device."""
    if not os.path.isdir(ANSIBLE_PLAYBOOKS_DIR):
        return []
    flows = []
    for fname in sorted(os.listdir(ANSIBLE_PLAYBOOKS_DIR)):
        if fname.endswith(".yml"):
            fpath = os.path.join(ANSIBLE_PLAYBOOKS_DIR, fname)
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()
            declared_mode = _extract_playbook_mode(content)
            # A file already sitting on disk that claims read_only but
            # actually references push-config is downgraded for display
            # rather than trusted — same verification as upload time.
            verified_mode = "write" if (declared_mode == "read_only" and _PUSH_CONFIG_MARKER in _strip_yaml_comments(content)) else declared_mode
            flows.append({
                "name": fname,
                "size_bytes": os.path.getsize(fpath),
                "mode": verified_mode,
                "required_vars": _extract_required_vars(content),
            })
    return flows

@app.get("/ansible/flows/{name}")
def get_ansible_flow(name: str):
    """Returns the raw YAML content of one playbook. Read-only."""
    path = _safe_playbook_path(name)
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    return {"name": name, "content": content, "required_vars": _extract_required_vars(content)}

@app.post("/ansible/flows/{name}/syntax-check")
async def syntax_check_ansible_flow(name: str):
    """Validates a playbook's YAML structure and module argument specs via
    `ansible-playbook --syntax-check`. This parses the playbook and looks up
    each module's argspec — it does NOT resolve the inventory or open any
    connection to any host, real or otherwise. Safe to run at any time."""
    path = _safe_playbook_path(name)
    proc = await asyncio.create_subprocess_exec(
        "ansible-playbook", path, "--syntax-check",
        cwd=ANSIBLE_DIR,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return {
        "name": name,
        "returncode": proc.returncode,
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
        "ok": proc.returncode == 0,
    }

@app.get("/ansible/collections")
async def list_ansible_collections():
    """Lists installed Ansible collections (ansible-galaxy collection list) —
    lets an operator verify the vendor libraries actually installed
    correctly at build time. No device interaction."""
    proc = await asyncio.create_subprocess_exec(
        "ansible-galaxy", "collection", "list",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return {
        "returncode": proc.returncode,
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
    }

@app.post("/ansible/flows/upload")
async def upload_ansible_flow(file: UploadFile = File(...)):
    """Uploads a new custom flow (playbook). Validated with --syntax-check
    before being accepted — a playbook that fails syntax validation is
    rejected and never saved, so playbooks/ never accumulates broken files.
    Uploading does not run anything against any device."""
    if not file.filename.endswith(".yml") and not file.filename.endswith(".yaml"):
        raise HTTPException(status_code=400, detail="Playbook must be a .yml/.yaml file")
    if not re.fullmatch(r"[A-Za-z0-9_\-]+\.ya?ml", file.filename):
        raise HTTPException(status_code=400, detail="Invalid filename — use letters, numbers, - and _ only")

    os.makedirs(ANSIBLE_PLAYBOOKS_DIR, exist_ok=True)
    dest_path = os.path.join(ANSIBLE_PLAYBOOKS_DIR, file.filename)
    content = await file.read()

    # Write to a temp file first and syntax-check THAT — never let a bad
    # upload overwrite a previously-good playbook of the same name before
    # we know it's valid.
    tmp_path = dest_path + ".upload_tmp"
    with open(tmp_path, "wb") as f:
        f.write(content)

    proc = await asyncio.create_subprocess_exec(
        "ansible-playbook", tmp_path, "--syntax-check",
        cwd=ANSIBLE_DIR,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        os.remove(tmp_path)
        raise HTTPException(
            status_code=400,
            detail=f"Playbook failed syntax check, not saved: {stderr.decode('utf-8', errors='replace')[:1000]}",
        )

    # Syntax passed — now verify any read_only claim against actual content
    # before accepting. A playbook that fails this is rejected outright,
    # same as a syntax failure: never saved.
    content_str = content.decode("utf-8", errors="replace")
    declared_mode = _extract_playbook_mode(content_str)
    try:
        _verify_playbook_mode_or_raise(content_str, declared_mode)
    except HTTPException:
        os.remove(tmp_path)
        raise

    os.replace(tmp_path, dest_path)
    logger.info("Ansible flow uploaded and validated: %s (mode=%s)", file.filename, declared_mode)
    return {"status": "success", "name": file.filename, "size_bytes": len(content), "mode": declared_mode}

@app.post("/ansible/collections/install")
async def install_ansible_collection(
    name: str = Body(..., embed=True),
    version: str = Body(None, embed=True),
):
    """Installs a new Ansible vendor collection via ansible-galaxy, and
    appends it to requirements.yml so it survives the next container
    rebuild instead of silently disappearing. Installing a collection adds
    capability — it does not touch, connect to, or run anything against
    any device."""
    if not re.fullmatch(r"[a-z0-9_]+\.[a-z0-9_]+", name):
        raise HTTPException(status_code=400, detail="Invalid collection name — expected format: namespace.collection")

    spec = f"{name}:{version}" if version else name
    proc = await asyncio.create_subprocess_exec(
        "ansible-galaxy", "collection", "install", spec,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    result = {
        "name": name,
        "version": version,
        "returncode": proc.returncode,
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
    }
    if proc.returncode != 0:
        raise HTTPException(status_code=400, detail=result)

    # Persist for next rebuild — append only if not already listed.
    req_path = os.path.join(ANSIBLE_DIR, "requirements.yml")
    try:
        with open(req_path, "r", encoding="utf-8") as f:
            existing = f.read()
        if f"name: {name}" not in existing:
            with open(req_path, "a", encoding="utf-8") as f:
                f.write(f"  - name: {name}\n")
                if version:
                    f.write(f'    version: "{version}"\n')
    except Exception as e:
        logger.warning("Installed %s but failed to persist to requirements.yml: %s", name, e)

    return {"status": "success", **result}
