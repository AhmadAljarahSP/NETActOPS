import os
import re
import glob
import json
import logging
import asyncio
import subprocess
import difflib
from typing import Optional, List
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx
from pypdf import PdfReader
import intent_router
import vector_sync
import config_loader

try:
    from cryptography.fernet import Fernet
except ImportError:
    Fernet = None

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("copilot-backend")

from contextlib import asynccontextmanager

def init_itsm_db():
    import sqlite3
    import agent
    try:
        conn = sqlite3.connect(agent.DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS itsm_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id TEXT UNIQUE,
                device_name TEXT,
                action_type TEXT,
                status TEXT, -- 'Pending' | 'Approved' | 'Rejected'
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.commit()
        conn.close()
        logger.info("Initialized itsm_tickets database table.")
    except Exception as e:
        logger.error("Failed to initialize itsm_tickets table: %s", e)

async def watch_obsidian_vault():
    """Background task to watch /app/obsidian_topology for file changes and trigger KB sync."""
    vault_path = os.getenv("VAULT_PATH", "/app/obsidian_topology")
    if not os.path.exists(vault_path):
        logger.warning("Vault path %s does not exist. Directory watcher skipped.", vault_path)
        return

    logger.info("Starting directory watcher for Obsidian vault: %s", vault_path)
    
    def scan_mtimes():
        current = {}
        for root, _, files in os.walk(vault_path):
            for file in files:
                if file.endswith('.md'):
                    path = os.path.join(root, file)
                    try:
                        current[path] = os.path.getmtime(path)
                    except Exception:
                        pass
        return current

    # Populate initial mtimes
    mtimes = scan_mtimes()
    sync_pending = False
    cooldown = 0.0
    
    while True:
        await asyncio.sleep(2)
        
        # Check if debounced sync should run
        if sync_pending and asyncio.get_event_loop().time() >= cooldown:
            logger.info("Auto-triggering Knowledge Base & Obsidian Vault sync due to Obsidian file updates...")
            sync_pending = False
            try:
                # Previously called sync_git_knowledgebase() with no lock at
                # all — if a PDF upload sync was already running (can take
                # hours), an Obsidian vault edit landing at the same moment
                # would kick off a second, fully concurrent embed run
                # against the same single-threaded Ollama instance, the
                # exact race already fixed for the upload endpoint. Route it
                # through the same lock/drain-schedule instead of calling it
                # directly.
                if _kb_sync_lock.locked():
                    _schedule_kb_sync_drain()
                else:
                    async with _kb_sync_lock:
                        await vector_sync.sync_git_knowledgebase()
                await vector_sync.sync_vault_notes_standalone()
            except Exception as e:
                logger.error("Auto KB/Vault sync failed: %s", e)
                
        # Scan files for changes
        try:
            current = scan_mtimes()
        except Exception as e:
            logger.error("Failed to scan directory mtimes: %s", e)
            continue
            
        changed = False
        # Check for modified or new files
        for path, mtime in current.items():
            if path not in mtimes or mtimes[path] != mtime:
                if "knowledgebase_registry.json" in path:
                    continue
                changed = True
                break
                
        # Check for deleted files
        if not changed:
            for path in mtimes:
                if path not in current:
                    changed = True
                    break
                    
        if changed:
            mtimes = current
            # Cooldown of 3 seconds to debounce consecutive writes
            cooldown = asyncio.get_event_loop().time() + 3.0
            sync_pending = True

@asynccontextmanager
async def lifespan(app: FastAPI):
    import agent
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
    
    init_itsm_db()
    logger.info("Initializing AsyncSqliteSaver checkpointer at %s", agent.DB_PATH)
    async with AsyncSqliteSaver.from_conn_string(agent.DB_PATH) as memory:
        # Gate on both write-action approval AND Gemini cloud transmission approval.
        # Operators must explicitly approve before any data leaves the local environment.
        agent.app = agent.builder.compile(checkpointer=memory, interrupt_before=["human_approval_gate"])
        logger.info("LangGraph compiled with AsyncSqliteSaver. human_approval_gate active; Gemini is opt-in via state machine.")
        watcher_task = asyncio.create_task(watch_obsidian_vault())
        # If the container restarts mid-drain (crash, redeploy, host
        # reboot), any backlog left over from before the restart would
        # otherwise sit unsynced forever — nothing else re-checks on its
        # own unless a new upload or vault edit happens to arrive later.
        # _schedule_kb_sync_drain() is cheap to call speculatively: if
        # nothing is actually out of date, sync_git_knowledgebase()'s hash
        # check makes the resulting pass a fast no-op.
        _schedule_kb_sync_drain()
        yield

app = FastAPI(title="NETAct AI Copilot Backend", version="1.0", lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Frontend is proxied, but allow all internally
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GIT_REPO_PATH = os.getenv("GIT_REPO_PATH", "/git/repo")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://NETAct_ollama:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")
OLLAMA_NUM_THREAD = int(os.getenv("OLLAMA_NUM_THREAD", "24"))
QDRANT_URL = os.getenv("QDRANT_HOST", "http://NETAct_qdrant:6333")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
APP_PASSWORD = os.getenv("APP_PASSWORD", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "").strip()
if not ENCRYPTION_KEY:
    ENCRYPTION_KEY = "OHzh5dWT-Ok6XzFtRip9uBVu9fGRnMsIwDX1ELUyqn8="

# ---------------------------------------------------------------------------
# Authentication Helper
# ---------------------------------------------------------------------------
async def verify_auth(x_api_key: str = Header(None)):
    if APP_PASSWORD and x_api_key != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid API Key")

# ---------------------------------------------------------------------------
# Utility Helpers: Git Backups & Text Parsing
# ---------------------------------------------------------------------------
def get_latest_backup_config(hostname: str) -> Optional[str]:
    """Scans the git repository directory for the latest backup of a host and automatically decrypts it if encrypted."""
    device_dir = os.path.join(GIT_REPO_PATH, "backups", hostname)
    if not os.path.isdir(device_dir):
        return None
    
    # List all backup text files
    txt_files = glob.glob(os.path.join(device_dir, "backup_*.txt"))
    if not txt_files:
        return None
    
    # Sort by filename (backup_YYYYMMDD_HHMMSS.txt naturally sorts alphabetically by date)
    txt_files.sort(reverse=True)
    latest_file = txt_files[0]
    
    try:
        with open(latest_file, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read().strip()
            
        # Check if the content is Fernet-encrypted (Fernet tokens start with 'gAAAAA')
        if content.startswith("gAAAAA"):
            if Fernet and ENCRYPTION_KEY:
                try:
                    fernet_instance = Fernet(ENCRYPTION_KEY.encode())
                    decrypted_bytes = fernet_instance.decrypt(content.encode('utf-8'))
                    decrypted_text = decrypted_bytes.decode('utf-8', errors='ignore')
                    logger.info(f"Successfully decrypted backup configuration for device {hostname} ({len(decrypted_text)} chars)")
                    return decrypted_text
                except Exception as dec_err:
                    logger.error(f"Failed to decrypt backup content for {hostname} using Fernet key: {dec_err}")
            else:
                logger.warning(f"Backup content for {hostname} is encrypted, but Fernet or ENCRYPTION_KEY is not available.")
                
        return content
    except Exception as e:
        logger.error(f"Error reading backup file {latest_file}: {e}")
        return None

def get_latest_healthcheck(hostname: str) -> Optional[str]:
    """Scans the git repository directory for the latest healthcheck of a host and automatically decrypts it if encrypted."""
    device_dir = os.path.join(GIT_REPO_PATH, "healthchecks", hostname)
    if not os.path.isdir(device_dir):
        return None
    
    # List all healthcheck text files
    txt_files = glob.glob(os.path.join(device_dir, "healthcheck_*.txt"))
    if not txt_files:
        return None
    
    # Sort by filename
    txt_files.sort(reverse=True)
    latest_file = txt_files[0]
    
    try:
        with open(latest_file, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read().strip()
            
        # Check if the content is Fernet-encrypted
        if content.startswith("gAAAAA"):
            if Fernet and ENCRYPTION_KEY:
                try:
                    fernet_instance = Fernet(ENCRYPTION_KEY.encode())
                    decrypted_bytes = fernet_instance.decrypt(content.encode('utf-8'))
                    decrypted_text = decrypted_bytes.decode('utf-8', errors='ignore')
                    logger.info(f"Successfully decrypted healthcheck for device {hostname} ({len(decrypted_text)} chars)")
                    return decrypted_text
                except Exception as dec_err:
                    logger.error(f"Failed to decrypt healthcheck content for {hostname} using Fernet key: {dec_err}")
            else:
                logger.warning(f"Healthcheck content for {hostname} is encrypted, but Fernet or ENCRYPTION_KEY is not available.")
                
        return content
    except Exception as e:
        logger.error(f"Error reading healthcheck file {latest_file}: {e}")
        return None


def sanitize_content(text: str) -> tuple[str, dict]:
    """Replaces real IP addresses and hostnames with generic tokens for secure cloud analysis."""
    ip_pattern = r"\b(?:\d{1,3}\.){3}\d{1,3}\b"
    ips = re.findall(ip_pattern, text)
    
    mapping = {}
    sanitized_text = text
    
    # Map IPs
    for i, ip in enumerate(list(set(ips))):
        token = f"IP_ADDR_{i+1}"
        mapping[token] = ip
        sanitized_text = sanitized_text.replace(ip, token)
        
    return sanitized_text, mapping

def restore_content(text: str, mapping: dict) -> str:
    """Restores real IPs and hostnames from generic tokens."""
    restored_text = text
    for token, real_val in mapping.items():
        restored_text = restored_text.replace(token, real_val)
    return restored_text

def run_git_command(args: List[str]) -> str:
    """Executes a git command inside the git backups repository directory."""
    try:
        res = subprocess.run(
            ["git", "-C", GIT_REPO_PATH] + args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
            encoding="utf-8"
        )
        return res.stdout
    except Exception as e:
        logger.error(f"Error executing git command {args}: {e}")
        return f"[Git Error: {str(e)}]"

def get_decrypted_config_diff(hostname: str) -> str:
    """Retrieves the latest two backup files for a host, decrypts them, and returns a unified plaintext diff."""
    device_dir = os.path.join(GIT_REPO_PATH, "backups", hostname)
    if not os.path.isdir(device_dir):
        return "[No backup folder found for this device]"
        
    txt_files = glob.glob(os.path.join(device_dir, "backup_*.txt"))
    if not txt_files:
        return "[No backup files found for this device]"
        
    # Sort chronologically by filename
    txt_files.sort()
    
    if len(txt_files) < 2:
        return "[Only one backup file exists; need at least two backups to compare differences]"
        
    prev_file = txt_files[-2]
    latest_file = txt_files[-1]
    
    try:
        # Read and decrypt predecessor
        with open(prev_file, "r", encoding="utf-8", errors="ignore") as f:
            prev_content = f.read().strip()
        if prev_content.startswith("gAAAAA") and Fernet and ENCRYPTION_KEY:
            try:
                fernet_instance = Fernet(ENCRYPTION_KEY.encode())
                prev_content = fernet_instance.decrypt(prev_content.encode('utf-8')).decode('utf-8', errors='ignore')
            except Exception as e:
                logger.error(f"Failed to decrypt previous config: {e}")
            
        # Read and decrypt latest
        with open(latest_file, "r", encoding="utf-8", errors="ignore") as f:
            latest_content = f.read().strip()
        if latest_content.startswith("gAAAAA") and Fernet and ENCRYPTION_KEY:
            try:
                fernet_instance = Fernet(ENCRYPTION_KEY.encode())
                latest_content = fernet_instance.decrypt(latest_content.encode('utf-8')).decode('utf-8', errors='ignore')
            except Exception as e:
                logger.error(f"Failed to decrypt latest config: {e}")
            
        # Generate unified diff
        diff_lines = list(difflib.unified_diff(
            prev_content.splitlines(),
            latest_content.splitlines(),
            fromfile=os.path.basename(prev_file),
            tofile=os.path.basename(latest_file),
            lineterm=""
        ))
        
        if not diff_lines:
            return "[No configuration differences detected between the two latest backups]"
            
        return "\n".join(diff_lines)
    except Exception as e:
        logger.error(f"Error generating decrypted config diff for {hostname}: {e}")
        return f"[Error generating configuration diff: {str(e)}]"


def get_decrypted_healthcheck_diff(hostname: str) -> str:
    """Retrieves the latest two healthcheck files for a host, decrypts them, and returns a unified plaintext diff."""
    device_dir = os.path.join(GIT_REPO_PATH, "healthchecks", hostname)
    if not os.path.isdir(device_dir):
        return "[No healthcheck folder found for this device]"
        
    txt_files = glob.glob(os.path.join(device_dir, "healthcheck_*.txt"))
    if not txt_files:
        return "[No healthcheck files found for this device]"
        
    # Sort chronologically by filename
    txt_files.sort()
    
    if len(txt_files) < 2:
        return "[Only one healthcheck file exists; need at least two healthchecks to compare differences]"
        
    prev_file = txt_files[-2]
    latest_file = txt_files[-1]
    
    try:
        # Read and decrypt predecessor
        with open(prev_file, "r", encoding="utf-8", errors="ignore") as f:
            prev_content = f.read().strip()
        if prev_content.startswith("gAAAAA") and Fernet and ENCRYPTION_KEY:
            try:
                fernet_instance = Fernet(ENCRYPTION_KEY.encode())
                prev_content = fernet_instance.decrypt(prev_content.encode('utf-8')).decode('utf-8', errors='ignore')
            except Exception as e:
                logger.error(f"Failed to decrypt previous healthcheck: {e}")
            
        # Read and decrypt latest
        with open(latest_file, "r", encoding="utf-8", errors="ignore") as f:
            latest_content = f.read().strip()
        if latest_content.startswith("gAAAAA") and Fernet and ENCRYPTION_KEY:
            try:
                fernet_instance = Fernet(ENCRYPTION_KEY.encode())
                latest_content = fernet_instance.decrypt(latest_content.encode('utf-8')).decode('utf-8', errors='ignore')
            except Exception as e:
                logger.error(f"Failed to decrypt latest healthcheck: {e}")
            
        # Generate unified diff
        diff_lines = list(difflib.unified_diff(
            prev_content.splitlines(),
            latest_content.splitlines(),
            fromfile=os.path.basename(prev_file),
            tofile=os.path.basename(latest_file),
            lineterm=""
        ))
        
        if not diff_lines:
            return "[No healthcheck differences detected between the two latest runs]"
            
        return "\n".join(diff_lines)
    except Exception as e:
        logger.error(f"Error generating decrypted healthcheck diff for {hostname}: {e}")
        return f"[Error generating healthcheck diff: {str(e)}]"


async def call_mcp_tool(tool_name: str, arguments: dict = None) -> str:
    """Connects to the NETAct MCP Server over SSE and invokes a tool."""
    try:
        from mcp import ClientSession
        from mcp.client.sse import sse_client
        
        mcp_url = os.getenv("NETACT_MCP_SERVER_URL", "http://NETAct_MCP_Server:5001/sse")
        logger.info(f"Connecting to MCP server at {mcp_url} to call tool '{tool_name}'...")
        
        async with sse_client(mcp_url) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                resp = await session.call_tool(tool_name, arguments or {})
                return "".join([c.text for c in resp.content])
    except Exception as e:
        logger.error(f"Error calling MCP tool '{tool_name}': {e}", exc_info=True)
        return f"[Error connecting to diagnostics engine: {str(e)}]"


async def stream_ollama_response(prompt: str, active_model: str):
    """Sends a prompt to Ollama chat API and yields the response chunks in real-time."""
    try:
        logger.info(f"Streaming Ollama response with model {active_model}...")
        async with httpx.AsyncClient(timeout=600.0) as client:
            async with client.stream(
                "POST",
                f"{OLLAMA_HOST}/api/chat",
                json={
                    "model": active_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": True,
                    "options": {
                        "temperature": 0.3,
                        "num_thread": OLLAMA_NUM_THREAD,
                        "num_predict": 512,
                        "num_ctx": 8192
                    }
                }
            ) as response:
                if response.status_code != 200:
                    yield f"🔴 Local diagnostics engine returned HTTP error code {response.status_code}."
                    return
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk_data = json.loads(line)
                        content_chunk = chunk_data.get("message", {}).get("content", "")
                        if content_chunk:
                            yield content_chunk
                    except Exception:
                        pass
    except Exception as e:
        logger.error(f"Error streaming Ollama response: {e}")
        yield f"🔴 LLM execution failed: {str(e)}"

async def query_qdrant_vector_db(query: str, limit: int = 5, disabled_docs: List[str] = []) -> List[dict]:
    """Queries Qdrant via direct REST API with keyword lexical scroll (no SDK required)."""
    # Build keywords for lexical scoring
    stopwords = {
        "what", "is", "the", "of", "for", "in", "on", "a", "an", "and", "or", "to", "from",
        "at", "by", "with", "about", "ip", "address", "find", "show", "get", "tell", "list",
        "search", "document", "documentation", "file", "pdf", "txt", "database", "vector"
    }
    words = re.findall(r"\b[a-zA-Z0-9_-]+\b", query.lower())
    keywords = [w for w in words if w not in stopwords]

    # Build optional must_not filter payload for disabled docs
    scroll_filter = None
    if disabled_docs:
        scroll_filter = {
            "must_not": [
                {"key": "filename", "match": {"value": doc}}
                for doc in disabled_docs
            ]
        }

    scroll_body: dict = {"limit": 1000, "with_payload": True, "with_vector": False}
    if scroll_filter:
        scroll_body["filter"] = scroll_filter

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{QDRANT_URL}/collections/netact_knowledgebase/points/scroll",
                json=scroll_body
            )
            resp.raise_for_status()
            points = resp.json().get("result", {}).get("points", [])

        scored_candidates = []
        for p in points:
            payload = p.get("payload", {})
            text = payload.get("text", "")
            text_lower = text.lower()
            keyword_matches = 0.0
            for kw in keywords:
                if kw in text_lower:
                    keyword_matches += 1
                    if re.search(rf"\b{re.escape(kw)}\b", text_lower):
                        keyword_matches += 0.5
            if keyword_matches > 0:
                scored_candidates.append({
                    "filename": payload.get("filename", "unknown"),
                    "page": payload.get("page", 1),
                    "text": text,
                    "boosted_score": keyword_matches * 0.1
                })

        scored_candidates.sort(key=lambda x: x["boosted_score"], reverse=True)
        return [
            {"filename": c["filename"], "page": c["page"], "text": c["text"]}
            for c in scored_candidates[:limit]
        ]
    except Exception as e:
        logger.error(f"Qdrant REST scroll failed: {e}")
        return []

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------
_kb_sync_lock    = asyncio.Lock()
_vault_sync_lock = asyncio.Lock()

# "Already in progress, will be picked up next sync" was previously a
# promise with nothing behind it — there is no scheduler anywhere in this
# project, so files uploaded while a long sync (large PDFs can take hours
# on CPU-only Ollama) was in flight sat unsynced indefinitely until someone
# happened to manually POST /api/copilot/sync again. This flag + helper
# guarantee exactly one follow-up drain pass runs automatically the moment
# the in-flight sync releases the lock, no matter how many uploads queued
# up behind it in the meantime.
_kb_sync_drain_scheduled = False

async def _drain_kb_sync_background():
    global _kb_sync_drain_scheduled
    async with _kb_sync_lock:
        try:
            total_kb = await vector_sync.sync_git_knowledgebase()
            total_vault = await vector_sync.sync_vault_notes_standalone()
            logger.info(f"Background KB/Vault sync drain completed: {total_kb} KB chunks and {total_vault} vault chunks uploaded.")
        except Exception as e:
            logger.error(f"Background KB/Vault sync drain failed: {e}")
    _kb_sync_drain_scheduled = False

def _schedule_kb_sync_drain():
    global _kb_sync_drain_scheduled
    if not _kb_sync_drain_scheduled:
        _kb_sync_drain_scheduled = True
        asyncio.create_task(_drain_kb_sync_background())

@app.post("/api/copilot/sync")
async def trigger_vector_sync():
    """Sync uploaded KB files (PDFs/docs from git knowledgebase) into Qdrant.
    Queues a follow-up drain pass if a sync is already running, instead of
    silently doing nothing."""
    if _kb_sync_lock.locked():
        _schedule_kb_sync_drain()
        return {"status": "queued", "reason": "KB sync already in progress — a follow-up pass has been queued to run automatically when it finishes"}
    async with _kb_sync_lock:
        try:
            total_points = await vector_sync.sync_git_knowledgebase()
            return {"status": "success", "synced_chunks": total_points}
        except Exception as e:
            logger.error(f"Failed to sync Git knowledgebase to Qdrant: {e}")
            raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/copilot/sync-vault")
async def trigger_vault_sync():
    """Sync Obsidian vault notes into Qdrant — separate from KB file sync.
    Skips immediately if a vault sync is already running."""
    if _vault_sync_lock.locked():
        return {"status": "skipped", "reason": "vault sync already in progress"}
    async with _vault_sync_lock:
        try:
            total_points = await vector_sync.sync_vault_notes_standalone()
            return {"status": "success", "synced_chunks": total_points}
        except Exception as e:
            logger.error(f"Failed to sync vault notes to Qdrant: {e}")
            raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/copilot/documents")
async def list_knowledgebase_documents():
    """Lists files in the knowledgebase folder with vector chunk counts."""
    kb_path = os.path.join(GIT_REPO_PATH, "knowledgebase")
    if not os.path.isdir(kb_path):
        return []

    counts = {}
    try:
        # Scroll ALL matching points via the cursor, not just the first
        # page — a fixed limit=1000 with no pagination silently undercounted
        # (reported chunk_count: 0 for files that were actually fully
        # indexed) once the collection grew past 1000 points total. Also
        # filter to source=knowledgebase so vault notes never get counted
        # against a same-named KB file.
        async with httpx.AsyncClient(timeout=30.0) as client:
            offset = None
            while True:
                body = {
                    "limit": 1000,
                    "with_payload": ["filename"],
                    "with_vector": False,
                    "filter": {"must": [{"key": "source", "match": {"value": "knowledgebase"}}]},
                }
                if offset is not None:
                    body["offset"] = offset
                resp = await client.post(
                    f"{QDRANT_URL}/collections/netact_knowledgebase/points/scroll",
                    json=body
                )
                resp.raise_for_status()
                result = resp.json().get("result", {})
                for p in result.get("points", []):
                    fname = p.get("payload", {}).get("filename")
                    if fname:
                        counts[fname] = counts.get(fname, 0) + 1
                offset = result.get("next_page_offset")
                if offset is None:
                    break
    except Exception as e:
        logger.error(f"Error compiling document counts: {e}")

    docs_list = []
    for name in os.listdir(kb_path):
        if name == "knowledgebase_registry.json":
            continue
        filepath = os.path.join(kb_path, name)
        if os.path.isfile(filepath):
            docs_list.append({
                "filename": name,
                "size_bytes": os.path.getsize(filepath),
                "chunk_count": counts.get(name, 0)
            })
    return docs_list

@app.post("/api/copilot/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    """Uploads a PDF or text document and indexes it into Qdrant."""
    kb_path = os.path.join(GIT_REPO_PATH, "knowledgebase")
    os.makedirs(kb_path, exist_ok=True)
    filepath = os.path.join(kb_path, file.filename)

    try:
        with open(filepath, "wb") as buffer:
            buffer.write(await file.read())

        # sync_git_knowledgebase() previously had no lock here at all (only
        # the manual /api/copilot/sync trigger used _kb_sync_lock) — uploading
        # a second file, or the same large file twice, while a sync was still
        # embedding a prior large PDF started a fully separate, concurrent
        # sync_git_knowledgebase() run competing for the same single-threaded
        # Ollama embedding slot, re-reading and re-chunking files the other
        # run was already partway through — confirmed via logs showing the
        # same large PDF's "Processing changed/new file" line 3 times with no
        # completion between them. If a sync is already running, this upload
        # is saved to disk and a follow-up drain pass is scheduled (see
        # _schedule_kb_sync_drain) so it's actually picked up automatically —
        # "will be picked up next sync" used to be a promise with no
        # scheduler behind it; a bulk upload of many large PDFs during a
        # multi-hour sync left 16 files silently stuck at 0 chunks for hours
        # until someone happened to manually re-trigger sync.
        if _kb_sync_lock.locked():
            _schedule_kb_sync_drain()
            logger.info("KB sync already in progress — %s saved, follow-up drain pass queued.", file.filename)
            return {"status": "queued", "filename": file.filename, "message": "A knowledge base sync is already running; a follow-up pass has been automatically queued to pick this file up as soon as it finishes."}

        async with _kb_sync_lock:
            total_chunks = await vector_sync.sync_git_knowledgebase()
        return {"status": "success", "filename": file.filename, "synced_chunks": total_chunks}
    except Exception as e:
        logger.error(f"Upload and sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/copilot/documents/{filename}")
async def delete_document(filename: str):
    """Deletes a document from Git filesystem and Qdrant storage."""
    kb_path = os.path.join(GIT_REPO_PATH, "knowledgebase")
    filepath = os.path.join(kb_path, filename)
    if os.path.isfile(filepath):
        os.remove(filepath)
    
    # Remove from registry
    try:
        vector_sync.remove_document_from_registry(filename)
    except Exception as e:
        logger.error(f"Failed to remove {filename} from registry: {e}")
    
    try:
        # This endpoint is already async — asyncio.run() here (previous
        # version) always raised "cannot be called from a running event
        # loop", so this delete has never actually succeeded against Qdrant;
        # the file/registry cleanup above ran, but the vectors themselves
        # were orphaned in Qdrant on every call. Just await it directly.
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{QDRANT_URL}/collections/netact_knowledgebase/points/delete",
                json={"filter": {"must": [{"key": "filename", "match": {"value": filename}}]}}
            )
            resp.raise_for_status()
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Failed to delete points from Qdrant: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/copilot/documents/download/{filename}")
def download_document(filename: str):
    """Downloads a file from the knowledgebase."""
    kb_path = os.path.join(GIT_REPO_PATH, "knowledgebase")
    filepath = os.path.join(kb_path, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="File not found")
    from fastapi.responses import FileResponse
    return FileResponse(filepath, filename=filename)

SANITIZATION_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "sanitization_config.json")

def load_sanitization_config() -> dict:
    if os.path.exists(SANITIZATION_CONFIG_PATH):
        try:
            with open(SANITIZATION_CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading sanitization config: {e}")
    return {
        "rules": {
            "mask_ips": True,
            "mask_hostnames": True,
            "mask_commands": True,
            "mask_emails": True
        },
        "custom_terms": [],
        "custom_regexes": []
    }

def save_sanitization_config(config: dict):
    try:
        with open(SANITIZATION_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving sanitization config: {e}")

@app.get("/api/copilot/sanitization/config")
async def get_sanitization_config():
    return load_sanitization_config()

@app.post("/api/copilot/sanitization/config")
async def update_sanitization_config(config: dict):
    save_sanitization_config(config)
    return {"status": "success"}

@app.get("/api/copilot/health")
async def health():
    return {"status": "healthy", "ollama_host": OLLAMA_HOST, "ollama_model": OLLAMA_MODEL}

@app.get("/metrics")
async def prometheus_metrics():
    """Prometheus scrape endpoint — exposes Gemini API and escalation metrics."""
    from fastapi.responses import Response
    import metrics as _m
    body, content_type = _m.metrics_response()
    return Response(content=body, media_type=content_type)


# Embedding-only models pulled for RAG/vault indexing — not chat-capable, would
# behave badly (or just error) if selected for synthesis via the frontend's
# model dropdown. Matched by name prefix since Ollama tags carry a version
# suffix (e.g. "nomic-embed-text:latest").
_EMBEDDING_ONLY_MODEL_PREFIXES = ("nomic-embed-text", "bge-m3")

@app.get("/api/copilot/models")
async def list_available_models():
    models = []
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_HOST}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                models = [
                    m["name"] for m in data.get("models", [])
                    if not m["name"].startswith(_EMBEDDING_ONLY_MODEL_PREFIXES)
                ]
    except Exception as e:
        logger.error(f"Error fetching models from Ollama: {e}")

    # Add Gemini Direct options
    models.extend(["gemini-2.5-flash (Gemini Direct)", "gemini-1.5-pro (Gemini Direct)"])
    return {"models": models}

@app.get("/api/copilot/devices")
async def list_devices():
    """Lists hostnames of all devices that have active Git configuration backups."""
    backups_dir = os.path.join(GIT_REPO_PATH, "backups")
    if not os.path.isdir(backups_dir):
        return []
    
    try:
        # Each folder name inside 'backups' represents a device hostname
        devices = [d for d in os.listdir(backups_dir) if os.path.isdir(os.path.join(backups_dir, d))]
        devices.sort()
        return devices
    except Exception as e:
        logger.error(f"Error listing backups directory: {e}")
        return []

@app.post("/api/copilot/audit")
async def audit_mop(
    mop_text: str = Form(...),
    hostname: str = Form(...),
    manual_file: Optional[UploadFile] = File(None),
    model: Optional[str] = Form(None)
):
    active_model = model or OLLAMA_MODEL
    # 1. Retrieve the latest running configuration locally
    live_config = get_latest_backup_config(hostname)
    if not live_config:
        logger.warning(f"No backup configuration found for device {hostname}")
        live_config = "# [No active configuration backups found for this device in Git repository]"

    extracted_manual_rules = ""
    prompt_lower = mop_text.lower().strip()

    # Smart Classification Helpers
    audit_kws = config_loader.get_app_audit_keywords()
    is_git_history = any(kw in prompt_lower for kw in audit_kws.get("git_history", []))
    is_git_diff = any(kw in prompt_lower for kw in audit_kws.get("git_diff", []))
    is_show_config = any(kw in prompt_lower for kw in audit_kws.get("show_config", []))
    
    is_conversational = (
        any(kw in prompt_lower for kw in audit_kws.get("conversational", []))
        or not any(cli_kw in prompt_lower for cli_kw in audit_kws.get("cli_indicators", []))
    )

    logger.info(f"--- COPILOT AUDIT REQUEST ---")
    logger.info(f"Hostname: {hostname}")
    logger.info(f"Raw Prompt: '{mop_text}'")
    logger.info(f"Classification: is_conversational={is_conversational}, is_git_history={is_git_history}, is_git_diff={is_git_diff}, is_show_config={is_show_config}")

    audit_prompts = config_loader.get_app_audit_prompts()

    # -----------------------------------------------------------------------
    # INTENT A: Get Git Backups History / Changes
    # -----------------------------------------------------------------------
    if is_git_history:
        git_logs = run_git_command(["log", "--oneline", "--", f"backups/{hostname}"])
        if not git_logs.strip() or "[Git Error" in git_logs:
            git_logs = "[No backup changes found in Git log history for this device]"

        prompt_tmpl = audit_prompts.get("git_history", "")
        ollama_prompt = prompt_tmpl.replace("{hostname}", hostname).replace("{git_logs}", git_logs)

    # -----------------------------------------------------------------------
    # INTENT B: Compare / Diff Backups
    # -----------------------------------------------------------------------
    elif is_git_diff:
        # Generate unified diff using our decryption diff helper
        git_diff = get_decrypted_config_diff(hostname)

        prompt_tmpl = audit_prompts.get("git_diff", "")
        ollama_prompt = prompt_tmpl.replace("{hostname}", hostname).replace("{git_diff}", git_diff[:40000])

    # -----------------------------------------------------------------------
    # INTENT C: Share / Display Configuration File
    # -----------------------------------------------------------------------
    elif is_show_config:
        if not live_config or "[No active configuration backups" in live_config:
            raise HTTPException(status_code=404, detail="No active backups found for this router in Git database.")

        # Bypass Ollama completely to return the 100% exact raw configuration without hallucinations!
        logger.info(f"Successfully bypassed Ollama and returned exact decrypted configuration for {hostname} instantly.")
        return {
            "status": "success",
            "hostname": hostname,
            "safety_report": (
                f"## 📋 Decrypted Running Configuration Backup for {hostname}\n\n"
                f"Below is the exact, complete configuration retrieved from your secure Git backup database:\n\n"
                f"```text\n{live_config}\n```"
            ),
            "vendor_rules_retrieved": False
        }

    # -----------------------------------------------------------------------
    # INTENT E: General Conversational Chat
    # -----------------------------------------------------------------------
    elif is_conversational:
        prompt_tmpl = audit_prompts.get("general_conversational", "")
        ollama_prompt = prompt_tmpl.replace("{hostname}", hostname).replace("{mop_text}", mop_text)

    # -----------------------------------------------------------------------
    # INTENT D: Standard planned configuration audit (MOP Audit)
    # -----------------------------------------------------------------------
    else:
        # 2. Extract PDF manual guidelines using Gemini (Cloud RAG) if a file was uploaded
        if manual_file and manual_file.filename.endswith(".pdf"):
            try:
                logger.info("PDF manual detected. Extracting text for Gemini RAG search...")
                pdf_bytes = await manual_file.read()

                reader = PdfReader(manual_file.file)
                pdf_text = ""
                for i in range(min(len(reader.pages), 100)):
                    page_text = reader.pages[i].extract_text()
                    if page_text:
                        pdf_text += page_text + "\n"

                if pdf_text.strip() and GEMINI_API_KEY:
                    # Use the full sanitizer (IPs + hostnames + emails + CLI tokens)
                    # so no sensitive data leaks to the Gemini cloud API.
                    import agent as _agent
                    sanitized_mop, san_map = _agent.sanitize_prompt(mop_text)

                    prompt_tmpl = audit_prompts.get("gemini_mop_rag", "")
                    gemini_prompt = prompt_tmpl.replace("{sanitized_mop}", sanitized_mop).replace("{pdf_text}", pdf_text[:400000])

                    async with httpx.AsyncClient(timeout=60.0) as client:
                        gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
                        response = await client.post(
                            gemini_url,
                            json={"contents": [{"parts": [{"text": gemini_prompt}]}]},
                            headers={"Content-Type": "application/json"}
                        )

                        if response.status_code == 200:
                            resp_data = response.json()
                            extracted_markdown = resp_data["candidates"][0]["content"]["parts"][0]["text"]
                            extracted_manual_rules = _agent.restore_prompt(extracted_markdown, san_map)
                            logger.info("Gemini successfully extracted manual guidelines!")
                        else:
                            logger.error(f"Gemini API returned error code {response.status_code}: {response.text}")

            except Exception as e:
                logger.error(f"Error running Gemini RAG extraction: {e}")

        system_rules = ""
        if extracted_manual_rules:
            system_rules = f"=== OFFICIAL VENDOR MANUAL SPECIFICATIONS (RETRIEVED VIA GEMINI) ===\n{extracted_manual_rules}\n\n"

        prompt_tmpl = audit_prompts.get("mop_audit", "")
        ollama_prompt = (prompt_tmpl
                         .replace("{hostname}", hostname)
                         .replace("{live_config}", live_config)
                         .replace("{system_rules}", system_rules)
                         .replace("{mop_text}", mop_text))

    # 4. Request Ollama to run the final local synthesis audit
    try:
        logger.info(f"Sending prompt to local Ollama service at {OLLAMA_HOST} using {active_model}...")
        async with httpx.AsyncClient(timeout=600.0) as client:
            ollama_response = await client.post(
                f"{OLLAMA_HOST}/api/chat",
                json={
                    "model": active_model,
                    "messages": [{"role": "user", "content": ollama_prompt}],
                    "stream": False,
                    "options": {
                        "temperature": 0.3,
                        "num_thread": OLLAMA_NUM_THREAD,
                        "num_predict": 512
                    }
                }
            )
            
            if ollama_response.status_code == 200:
                resp_json = ollama_response.json()
                audit_report = resp_json["message"]["content"]
                return {
                    "status": "success",
                    "hostname": hostname,
                    "safety_report": audit_report,
                    "vendor_rules_retrieved": bool(extracted_manual_rules)
                }
            else:
                logger.error(f"Ollama returned error code {ollama_response.status_code}: {ollama_response.text}")
                raise HTTPException(status_code=502, detail="Failed to communicate with local Ollama service")
                
    except Exception as e:
        logger.error(f"Error querying local Ollama container: {e}")
        raise HTTPException(status_code=500, detail=f"Ollama execution error: {str(e)}")


def try_parse_config_entity(hostname: str, query_lower: str) -> Optional[str]:
    """Attempts to parse specific blocks (interfaces, routing, VLANs) directly from the backup configuration file."""
    config = get_latest_backup_config(hostname)
    if not config:
        return None
    
    # 1. Match Interface keywords and slot IDs
    # Look for interface names like gigabitethernet 0/0/7, eth 0/0/7, ge 0/0/7, vlan 10, loopback 0
    if "interface" in query_lower or "port" in query_lower or "eth" in query_lower or "ge " in query_lower or "vlan" in query_lower or "loopback" in query_lower:
        # Regex to capture interface type and numbers (e.g. gigabitethernet0/0/7, eth-trunk 1, vlanif 10, loopback 0)
        pattern = r"\b(gigabitethernet|ethernet|fastethernet|vlanif|vlan|loopback|eth-trunk|ge|xge|10ge)\s*(\d+(?:/\d+)*)\b"
        match = re.search(pattern, query_lower)
        if match:
            iface_type = match.group(1).lower()
            iface_num = match.group(2)
            
            # Standardize interface names for lookup (e.g., ge -> GigabitEthernet)
            standard_type = iface_type
            if iface_type in ["ge", "gigabitethernet"]:
                standard_type = "GigabitEthernet"
            elif iface_type == "ethernet":
                standard_type = "Ethernet"
            elif iface_type in ["xge", "10ge"]:
                standard_type = "10GE"
            elif iface_type == "eth-trunk":
                standard_type = "Eth-Trunk"
            elif iface_type == "vlanif":
                standard_type = "Vlanif"
            elif iface_type == "vlan":
                standard_type = "vlan"
                
            # Search configuration lines for this interface block
            lines = config.split("\n")
            iface_block = []
            in_block = False
            
            # Build standard search key (case insensitive check)
            search_key = f"interface {standard_type}{iface_num}".lower()
            if standard_type == "vlan":
                search_key = f"vlan {iface_num}".lower()
                
            for line in lines:
                line_strip = line.strip()
                if line.lower().startswith(search_key) or (standard_type == "vlan" and line_strip.lower() == search_key):
                    in_block = True
                    iface_block.append(line)
                    continue
                if in_block:
                    # Check block ending indicators
                    if line.startswith("#") or line.startswith("!"):
                        iface_block.append(line)
                        break
                    if line.lower().startswith("interface") or (line.strip() == "" and len(iface_block) > 5) or (line.startswith(" ") == False and line.startswith("\t") == False and line.strip() != ""):
                        break
                    iface_block.append(line)
                    
            if iface_block:
                block_text = "\n".join(iface_block).strip()
                status = "🟢 Up / Enabled"
                if "shutdown" in block_text.lower():
                    status = "🔴 Down / Disabled"
                
                md = f"### 🩺 Interface Configuration Details for **{hostname}**\n\n"
                md += f"Found the exact configuration block for **{standard_type}{iface_num}** in the secure Git backups:\n\n"
                md += f"* **Interface**: `{standard_type}{iface_num}`\n"
                md += f"* **Status**: **{status}**\n\n"
                md += f"```text\n{block_text}\n```\n\n"
                md += f"*To request deep log diagnostics or troubleshooting advice for this interface, ask me a conceptual question (e.g. 'Why is {standard_type}{iface_num} down?').*"
                return md
                
    # 2. Match Routing Protocols (BGP, OSPF)
    if "bgp" in query_lower or "ospf" in query_lower or "rip" in query_lower:
        protocol = None
        if "bgp" in query_lower:
            protocol = "bgp"
        elif "ospf" in query_lower:
            protocol = "ospf"
            
        if protocol:
            lines = config.split("\n")
            proto_block = []
            in_block = False
            for line in lines:
                if line.lower().startswith(f"router {protocol}") or line.lower().startswith(f"{protocol} "):
                    in_block = True
                    proto_block.append(line)
                    continue
                if in_block:
                    if line.startswith("!") or line.startswith("#") or (line.startswith(" ") == False and line.startswith("\t") == False and line.strip() != ""):
                        break
                    proto_block.append(line)
                    
            if proto_block:
                block_text = "\n".join(proto_block).strip()
                md = f"### 🔀 Routing Protocol Configuration for **{hostname}**\n\n"
                md += f"Found the verified **{protocol.upper()}** configuration block on this device:\n\n"
                md += f"```text\n{block_text}\n```"
                return md
                
    return None


# ---------------------------------------------------------------------------
# Conversational Multi-Turn Network Agent Models and Route
# ---------------------------------------------------------------------------
class Message(BaseModel):
    role: str
    content: str

class ChatPayload(BaseModel):
    messages: List[Message]
    hostname: Optional[str] = None
    mode: Optional[str] = "copilot_only"  # "copilot_only" or "ollama_model"
    model: Optional[str] = None
    disabled_docs: Optional[List[str]] = []
    conversation_id: Optional[str] = None

# ===========================================================================
# PRESERVED: Local Python/Regex Heuristics Classifier (Disabled)
# To re-enable local heuristics-based classification, copy this logic back
# to classify_intent_with_ollama.
# ===========================================================================
def classify_intent_with_local_heuristics_DISABLED(query: str, query_lower: str) -> Optional[dict]:
    # Try finding device first
    device = None
    ip_match = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", query)
    if ip_match:
        device = ip_match.group(0)
    else:
        for word in query.split():
            clean_word = word.strip(".,;:?!'\"()[]{}")
            if (clean_word.startswith("ISP-") or clean_word.startswith("ES-") or 
                clean_word.startswith("WAC-") or clean_word.startswith("KTC-") or 
                clean_word.startswith("KTR-") or clean_word.startswith("WBC-") or
                clean_word.startswith("ES_") or clean_word.startswith("DR_") or
                clean_word.endswith("-01") or clean_word.endswith("-02") or
                "tor" in clean_word.lower() or "eor" in clean_word.lower() or
                "gw" in clean_word.lower()):
                device = clean_word
                break

    # If a specific device is mentioned, check operational queries on it first!
    if device:
        # Check diagnostic command runs first
        if any(kw in query_lower for kw in ["run diagnostic", "run diagnostics", "run command", "run cli", "diagnose"]):
            return {"intent": "run_diagnostic", "device": device, "flow_name": None}
            
        # Check config drift checks
        if any(kw in query_lower for kw in ["configuration drift", "config drift", "drift audit", "check drift"]):
            return {"intent": "audit_config_changes", "device": device, "flow_name": None}

        # Check compare/diff config backups
        if any(kw in query_lower for kw in ["compare", "diff", "difference", "what changed"]):
            if any(kw in query_lower for kw in ["config", "backup", "running"]):
                return {"intent": "compare_configs", "device": device, "flow_name": None}
                
        # Check run/trigger backup on-demand
        if "backup" in query_lower and any(kw in query_lower for kw in ["run", "trigger", "collect", "take", "start"]):
            return {"intent": "run_backup", "device": device, "flow_name": None}
            
        # Check run/trigger healthcheck on-demand
        if "health" in query_lower and any(kw in query_lower for kw in ["run", "trigger", "collect", "perform", "start"]):
            return {"intent": "run_healthcheck", "device": device, "flow_name": None}

        # Check display/show configuration (e.g. "share last Backup for 203.0.113.10", "show config for demo-router-01")
        if any(kw in query_lower for kw in ["config", "backup", "running", "share"]):
            if any(kw in query_lower for kw in ["show", "view", "get", "print", "display", "share", "last"]):
                return {"intent": "show_config", "device": device, "flow_name": None}

    # 1. Quick local heuristics for general/list commands without a device
    if any(kw in query_lower for kw in ["list node", "show node", "get node", "list device", "show device", "get device", "available node", "available device"]):
        return {"intent": "list_nodes", "device": None, "flow_name": None}
    if any(kw in query_lower for kw in ["list backup", "show backup", "get backup", "available backup"]):
        return {"intent": "list_backups", "device": None, "flow_name": None}
    if any(kw in query_lower for kw in ["list health", "show health", "get health", "available health"]):
        return {"intent": "list_healthchecks", "device": None, "flow_name": None}
    if any(kw in query_lower for kw in ["active alarm", "show alarm", "list alarm", "what alarm", "failed backup", "failed healthcheck", "unresolved issue"]):
        return {"intent": "active_alarms", "device": None, "flow_name": None}
    if any(kw in query_lower for kw in ["eol", "eos", "compliance", "expired", "hardware compliance", "software compliance"]):
        return {"intent": "eoleos_compliance", "device": None, "flow_name": None}
    
    return None


# ===========================================================================
# PRESERVED: Local Python Direct Markdown Generators (Disabled)
# To re-enable direct Python generation, copy this logic back to the chat route.
# ===========================================================================
def list_nodes_DISABLED(devices_list) -> str:
    if not devices_list:
        return "### 📋 Registered Network Nodes\n\nNo devices are registered in the YAML configuration databases."
    md = "### 📋 Registered Network Nodes\n\n"
    md += "Here are all the live network nodes registered in the main database:\n\n"
    md += "| ID | Hostname | IP Address | Vendor | Protocol | Port | Group |\n"
    md += "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n"
    for dev in devices_list:
        md += f"| {dev.get('id')} | **{dev.get('hostname')}** | `{dev.get('ip_address')}` | {str(dev.get('vendor')).upper()} | {dev.get('protocol')} | {dev.get('port')} | `{dev.get('group') or 'default'}` |\n"
    return md

def list_backups_DISABLED(backups_dir) -> str:
    from datetime import datetime
    md = "### 📂 Available Configuration Backups in Git\n\n"
    md += "Below is the summary of configuration backup records securely decrypted and stored in git:\n\n"
    md += "| Device Hostname | Latest Backup Date | Status | File Size |\n"
    md += "| :--- | :--- | :--- | :--- |\n"
    has_backups = False
    for dev_name in sorted(os.listdir(backups_dir)):
        dev_dir = os.path.join(backups_dir, dev_name)
        if not os.path.isdir(dev_dir):
            continue
        files = sorted(glob.glob(os.path.join(dev_dir, "*.txt")))
        if files:
            has_backups = True
            latest_file = files[-1]
            fname = os.path.basename(latest_file)
            
            date_str = fname.replace("backup_", "").replace(".txt", "")
            try:
                dt = datetime.strptime(date_str, "%Y%m%d_%H%M%S")
                formatted_date = dt.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                formatted_date = date_str
            
            status = "🟢 Success"
            try:
                with open(latest_file, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read().strip()
                if content.startswith("gAAAAA") and Fernet and ENCRYPTION_KEY:
                    try:
                        fernet_instance = Fernet(ENCRYPTION_KEY.encode())
                        decrypted_bytes = fernet_instance.decrypt(content.encode('utf-8'))
                        content = decrypted_bytes.decode('utf-8', errors='ignore')
                    except Exception:
                        pass
                if "[ERROR]" in content or "failed" in content.lower():
                    status = "🔴 Failed"
            except Exception:
                pass
                
            size = os.path.getsize(latest_file)
            md += f"| **{dev_name}** | {formatted_date} | {status} | `{size} bytes` |\n"
    if not has_backups:
        md += "| - | No configuration backups found | - | - |\n"
    return md

def list_healthchecks_DISABLED(health_dir) -> str:
    from datetime import datetime
    md = "### 🩺 Available Device Healthchecks in Git\n\n"
    md += "Below is the summary of device healthcheck diagnostic logs stored in git:\n\n"
    md += "| Device Hostname | Latest Diagnostic Run | Status |\n"
    md += "| :--- | :--- | :--- |\n"
    has_health = False
    for dev_name in sorted(os.listdir(health_dir)):
        dev_dir = os.path.join(health_dir, dev_name)
        if not os.path.isdir(dev_dir):
            continue
        files = sorted(glob.glob(os.path.join(dev_dir, "*.txt")))
        if files:
            has_health = True
            latest_file = files[-1]
            fname = os.path.basename(latest_file)
            
            date_str = fname.replace("healthcheck_", "").replace(".txt", "")
            try:
                dt = datetime.strptime(date_str, "%Y%m%d_%H%M%S")
                formatted_date = dt.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                formatted_date = date_str
            
            status = "🟢 Safe / OK"
            try:
                with open(latest_file, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read().strip()
                if content.startswith("gAAAAA") and Fernet and ENCRYPTION_KEY:
                    try:
                        fernet_instance = Fernet(ENCRYPTION_KEY.encode())
                        decrypted_bytes = fernet_instance.decrypt(content.encode('utf-8'))
                        content = decrypted_bytes.decode('utf-8', errors='ignore')
                    except Exception:
                        pass
                if "[ERROR]" in content or "failed" in content.lower():
                        status = "🔴 Danger / Failed"
            except Exception:
                pass
                
            md += f"| **{dev_name}** | {formatted_date} | {status} |\n"
    if not has_health:
        md += "| - | No healthcheck records found | - |\n"
    return md


_OPERATIONAL_PREFIXES = ("run ", "execute ", "trigger ", "collect ", "start ", "perform ")

async def resolve_device(device_str: Optional[str], user_query: str, messages: List[Message], headers: dict) -> Optional[dict]:
    """Resolves a device name/IP to a registered device record.

    History fallback is intentionally BLOCKED for operational commands
    (run/execute/trigger/collect/start/perform). Falling back to a device
    from conversation history on an execute command would silently act on
    the wrong device — the operator must name it explicitly.
    """
    is_operational = any(user_query.lower().strip().startswith(p) for p in _OPERATIONAL_PREFIXES)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("http://NETAct_backend:8000/devices", headers=headers)
            if resp.status_code == 200:
                devices_list = resp.json()

                def find_match(s: str):
                    s_clean = s.strip().lower()
                    for dev in devices_list:
                        hname = dev.get("hostname", "").lower()
                        ip = dev.get("ip_address", "")
                        if s_clean == hname or s_clean == ip or s_clean in hname:
                            return dev
                    return None

                # 1. Exact match on LLM-extracted device string
                if device_str:
                    matched = find_match(device_str)
                    if matched:
                        return matched

                # 2. Match device by normalized words (e.g. "ISP LON GW" -> "demo-router-01")
                matched = None
                ip_match = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", user_query)
                if ip_match:
                    # Strict IP Address Check
                    matched = find_match(ip_match.group(0))
                    # If IP is specified, we must ONLY return the match (never do fuzzy words fallback)
                    return matched
                
                if not matched:
                    query_clean = user_query.lower().replace("-", " ").replace("_", " ")
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
                                matched_candidates.append(dev)
                        
                        # Only resolve if exactly one device uniquely matches the component words
                        if len(matched_candidates) == 1:
                            matched = matched_candidates[0]

                # Fallback to substring matching
                if not matched:
                    for dev in devices_list:
                        hname = dev.get("hostname", "")
                        if hname and hname.lower() in user_query.lower():
                            matched = dev
                            break

                if matched:
                    return matched

                # 3. History fallback — ONLY for informational queries, never operational
                # ones, and never when the current query already names its own
                # platform/model (e.g. "OSPF on Huawei NE9000") — that's a
                # self-contained documentation question, not a follow-up about
                # whatever device was mentioned earlier in the thread. Confirmed
                # live: without this, an unrelated inventory device silently
                # attached to a fully self-contained platform question.
                query_names_own_platform = bool(re.search(r"\b[a-z]{2,4}\d{3,5}\b", user_query, re.IGNORECASE))
                if not is_operational and not query_names_own_platform:
                    for msg in reversed(messages[:-1]):
                        msg_content = msg.content
                        hist_ip_match = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", msg_content)
                        if hist_ip_match:
                            matched = find_match(hist_ip_match.group(0))
                            if matched:
                                return matched
                        for dev in devices_list:
                            hname = dev.get("hostname", "")
                            if hname and hname.lower() in msg_content.lower():
                                return dev
                else:
                    logger.info("resolve_device: history fallback skipped for operational command.")

    except Exception as e:
        logger.error(f"Error in resolve_device: {e}")
    return None

# ---------------------------------------------------------------------------
# Gemini escalation helpers
# ---------------------------------------------------------------------------

def _build_masking_table(mapping: dict) -> str:
    """Formats the sanitization mapping as a readable verification table."""
    if not mapping:
        return "🔒 *No sensitive values were detected and masked.*"
    lines = ["🔒 **Masking applied — verify your data was replaced correctly:**\n"]
    lines.append("| Token | Original value |")
    lines.append("|---|---|")
    for token, real_val in sorted(mapping.items()):
        lines.append(f"| `{token}` | `{real_val}` |")
    return "\n".join(lines)

async def _call_gemini_with_stored_prompt(state_values: dict) -> str:
    """Calls Gemini directly using the sanitized prompt already stored in state."""
    import agent
    import metrics as _m
    import time
    sanitized_prompt = state_values.get("gemini_prompt_preview", "")
    mapping_str = state_values.get("sanitization_mapping", "{}")
    model_name = state_values.get("active_model", "gemini-2.5-flash")
    target_model = "gemini-1.5-pro" if "1.5-pro" in model_name else "gemini-2.5-flash"

    try:
        mapping = json.loads(mapping_str)
    except Exception:
        mapping = {}

    start_time = time.time()
    raw = ""
    if GEMINI_API_KEY:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent?key={GEMINI_API_KEY}"
            payload = {"contents": [{"parts": [{"text": sanitized_prompt}]}]}
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.post(url, json=payload)
                duration = time.time() - start_time
                if res.status_code == 200:
                    res_data = res.json()
                    candidates = res_data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        raw = "".join(p.get("text", "") for p in parts)
                    usage = res_data.get("usageMetadata", {})
                    in_tok = usage.get("promptTokenCount", 0)
                    out_tok = usage.get("candidatesTokenCount", 0)
                    _m.record_gemini_call(target_model, duration, "success", in_tok, out_tok)
                else:
                    logger.error(f"Gemini API error {res.status_code}: {res.text}")
                    _m.record_gemini_call(target_model, duration, "error", 0, 0)
                    raw = f"⚠️ Gemini API returned status code {res.status_code}."
        except Exception as e:
            duration = time.time() - start_time
            logger.error(f"Error invoking Gemini API: {e}")
            _m.record_gemini_call(target_model, duration, "error", 0, 0)
            raw = f"⚠️ Gemini API invocation error: {e}"
    else:
        raw = await agent.call_llm([{"role": "user", "content": sanitized_prompt}])

    return agent.restore_prompt(raw, mapping)

def _show_gemini_gate(gemini_prompt: str, mapping: dict, has_tool_results: bool, thread_id: str) -> str:
    """Renders the appropriate approval gate message (standard or strict)."""
    masking_table = _build_masking_table(mapping)
    prompt_block = f"```text\n{gemini_prompt}\n```"

    if has_tool_results:
        return (
            f"⚠️ **WARNING — LIVE DEVICE TELEMETRY INCLUDED**\n\n"
            f"This prompt contains actual output collected from your network devices. "
            f"Even after sanitization, interface names, route prefixes, AS numbers, "
            f"VRF names and protocol states may still be present.\n\n"
            f"📤 **What will be sent to Gemini:**\n{prompt_block}\n\n"
            f"{masking_table}\n\n"
            f"Type **`confirm send`** to proceed · **`no`** to keep the local answer.\n"
            f"<!-- ACTION: GEMINI_STRICT_GATE, THREAD: {thread_id} -->"
        )
    else:
        return (
            f"🛡️ **Gemini Approval**\n\n"
            f"📤 **What will be sent to Gemini:**\n{prompt_block}\n\n"
            f"{masking_table}\n\n"
            f"Reply **`yes`** to send · **`no`** to keep the local answer.\n"
            f"<!-- ACTION: GEMINI_STANDARD_GATE, THREAD: {thread_id} -->"
        )


@app.post("/api/copilot/chat")
async def copilot_chat(payload: ChatPayload):
    if not payload.messages:
        raise HTTPException(status_code=400, detail="Messages list is empty.")

    user_query = payload.messages[-1].content
    query_lower = user_query.lower().strip()

    # Fast-path greetings
    if query_lower in ["hi", "hello", "hey", "greetings", "hi copilot", "hello copilot", "hey copilot", "help", "menu", "what can you do"]:
        async def greeting_generator():
            yield (
                "👋 **Hello! Welcome to NETAct AI Copilot!**\n\n"
                "I am your local network operations assistant. "
                "I can execute direct tasks instantly or use my local reasoning engine to assist you.\n\n"
                "Here are some commands you can try:\n"
                "* **List registered nodes** — type `list nodes`\n"
                "* **Check secure Git backups** — type `list backups`\n"
                "* **Review healthchecks** — type `list healthchecks`\n"
                "* **Collect backup on-demand** — type `run backup for <hostname>`\n"
                "* **Trigger healthcheck on-demand** — type `run healthcheck for <hostname>`\n"
                "* **Run automation workflow** — type `run automation <flow-name>`\n"
                "* **Analyze diagnostic logs** — type `analyze healthcheck logs of <hostname>`\n\n"
                "Type **`gemini`** at any time to escalate to the Gemini cloud API.\n\n"
                "How can I support your network operations today?"
            )
        return StreamingResponse(greeting_generator(), media_type="text/plain")

    async def chat_stream_generator():
        try:
            import agent
            import time
            import audit_trail

            thread_id = payload.conversation_id or "default_thread"
            config = {"configurable": {"thread_id": thread_id}}
            audit_trail.write_audit_log(thread_id, "user_query", {"query": user_query})

            cur_state = await agent.app.aget_state(config)

            # ----------------------------------------------------------------
            # STATE MACHINE — check what's pending before starting a new run
            # ----------------------------------------------------------------

            # A) Gemini gate is shown, operator is responding (yes/no/confirm send)
            if cur_state.values.get("gemini_gate_pending"):
                gate_type = cur_state.values.get("gemini_gate_type", "standard")
                is_standard_ok = query_lower in ["yes", "y", "approve"]
                is_strict_ok = query_lower in ["confirm send", "confirm", "send"]
                is_decline = query_lower in ["no", "n", "decline", "cancel"]

                approved = (gate_type == "standard" and is_standard_ok) or \
                           (gate_type == "strict" and is_strict_ok)

                if approved:
                    yield "✅ **Approved — querying Gemini...**\n\n"
                    audit_trail.write_audit_log(thread_id, "operator_approval", {
                        "gate": f"gemini_{gate_type}_gate", "status": "approved"
                    })
                    try:
                        import metrics as _m; _m.record_escalation_confirmed()
                    except Exception: pass
                    gemini_answer = await _call_gemini_with_stored_prompt(cur_state.values)
                    await agent.app.aupdate_state(config, {
                        "gemini_gate_pending": False,
                        "final_response": gemini_answer,
                    })
                    audit_trail.write_audit_log(thread_id, "assistant_response", {"response": gemini_answer})
                    yield gemini_answer
                    return

                elif is_decline:
                    await agent.app.aupdate_state(config, {"gemini_gate_pending": False})
                    audit_trail.write_audit_log(thread_id, "operator_approval", {
                        "gate": f"gemini_{gate_type}_gate", "status": "declined"
                    })
                    try:
                        import metrics as _m; _m.record_escalation_rejected()
                    except Exception: pass
                    yield "❌ **Transmission declined.** The local answer stands."
                    return

                else:
                    if gate_type == "strict":
                        yield "⚠️ Reply **`confirm send`** to proceed · **`no`** to keep the local answer."
                    else:
                        yield "⚠️ Reply **`yes`** to send · **`no`** to keep the local answer."
                    return

            # B) Operator types 'gemini' — escalate last answer to Gemini
            if query_lower.strip() == "gemini":
                gemini_prompt = cur_state.values.get("gemini_prompt_preview", "")
                if not gemini_prompt:
                    yield "⚠️ No previous query to escalate. Please ask a question first."
                    return

                has_tools = cur_state.values.get("has_tool_results", False)
                gate_type = "strict" if has_tools else "standard"
                mapping_str = cur_state.values.get("sanitization_mapping", "{}")
                try:
                    mapping = json.loads(mapping_str)
                except Exception:
                    mapping = {}

                await agent.app.aupdate_state(config, {
                    "gemini_gate_pending": True,
                    "gemini_gate_type": gate_type,
                })
                audit_trail.write_audit_log(thread_id, "gemini_escalation_requested", {
                    "gate_type": gate_type, "has_tool_results": has_tools
                })
                try:
                    import metrics as _m; _m.record_escalation_triggered()
                except Exception: pass
                yield _show_gemini_gate(gemini_prompt, mapping, has_tools, thread_id)
                return

            # C) Graph interrupt — human_approval_gate for write actions
            if cur_state.next:
                is_approve = query_lower in ["yes", "approve", "confirm", "go ahead", "run it", "y", "ok", "proceed"]
                is_reject = query_lower in ["no", "reject", "cancel", "stop", "decline", "n"]

                if is_approve or is_reject:
                    current_gate = cur_state.next[0]
                    if is_approve:
                        yield "✅ **Resuming execution: Action approved by operator.**\n\n"
                        audit_trail.write_audit_log(thread_id, "operator_approval", {
                            "gate": "human_approval_gate", "status": "approved"
                        })
                        requested_at = cur_state.values.get("approval_requested_at", 0.0)
                        if requested_at and (time.time() - requested_at) > 300:
                            yield "⏰ **Timeout reached**: The 5-minute window expired. Declining action.\n\n"
                            await agent.app.aupdate_state(config, {"approval_status": "rejected"}, as_node="human_approval_gate")
                        else:
                            await agent.app.aupdate_state(config, {"approval_status": "approved"}, as_node="human_approval_gate")

                        async for stream_mode, event in agent.app.astream(None, config, stream_mode=["updates", "custom"]):
                            if stream_mode == "custom":
                                yield event
                                continue
                            for node_name, node_update in event.items():
                                if node_name == "tool_executor_start":
                                    yield f"⚡ *Starting execution of {node_update.get('count', 0)} commands...*\n\n"
                                elif node_name == "tool_progress":
                                    yield f"⏳ *[{node_update.get('index')}/{node_update.get('total')}] Running: `{node_update.get('command')}`...*\n\n"
                                elif node_name == "tool_executor":
                                    yield "✅ *Telemetry collection complete.*\n\n"
                                elif node_name == "local_synthesizer":
                                    yield "✍️ *Synthesizing report with local AI...*\n\n"

                        new_state = await agent.app.aget_state(config)
                        final_ans = new_state.values.get("final_response", "")
                        audit_trail.write_audit_log(thread_id, "assistant_response", {"response": final_ans})
                        yield final_ans
                        return

                    elif is_reject:
                        yield "❌ **Action rejected by operator.**\n\n"
                        audit_trail.write_audit_log(thread_id, "operator_approval", {
                            "gate": "human_approval_gate", "status": "rejected"
                        })
                        await agent.app.aupdate_state(config, {"approval_status": "rejected"}, as_node="human_approval_gate")
                        async for _ in agent.app.astream(None, config, stream_mode=["updates", "custom"]):
                            pass
                        new_state = await agent.app.aget_state(config)
                        final_ans = new_state.values.get("final_response", "")
                        audit_trail.write_audit_log(thread_id, "assistant_response", {"response": final_ans})
                        yield final_ans
                        return
                else:
                    # User submitted a new query, ignoring the previous approval request.
                    # Automatically reject the previous action and clear the state.
                    logger.info("ITSM Gating: New query received while thread is interrupted. Automatically rejecting previous pending action.")
                    await agent.app.aupdate_state(config, {"approval_status": "rejected"}, as_node="human_approval_gate")
                    async for _ in agent.app.astream(None, config, stream_mode=["updates", "custom"]):
                        pass
                    cur_state = await agent.app.aget_state(config)

            # ----------------------------------------------------------------
            # NEW QUERY — classify intent then run the LangGraph agent
            # ----------------------------------------------------------------
            active_model = payload.model or OLLAMA_MODEL
            classification = await intent_router.classify_intent_with_ollama(
                query=user_query,
                history=payload.messages,
                mode=payload.mode,
                # Deliberately no model= at all — classification always uses
                # classify_intent_with_ollama()'s own default (CLASSIFIER_MODEL,
                # qwen2.5:0.5b-instruct), regardless of active_model/payload.model.
                # Those select which model answers via the frontend's model
                # dropdown (see AgentState.active_model, wired into
                # local_synthesizer_node's call_ollama_stream below) — a chat
                # model choice, not a classifier choice. Letting it flow into
                # classification (an earlier version of this fix did, for any
                # *explicit* selection) meant picking a model in the UI could
                # silently change how every query gets classified, producing
                # different (sometimes worse) results than the benchmark suite
                # ever tested, since benchmark.py correctly never passes model=
                # at all either.
            )
            intent = classification.get("intent")
            device_str = classification.get("device")
            flow_name = classification.get("flow_name")

            headers = {"X-API-Key": APP_PASSWORD}
            resolved_dev = await resolve_device(device_str, user_query, payload.messages, headers)
            target_device = resolved_dev.get("hostname") if resolved_dev else device_str

            local_generator = await intent_router.route_intent_locally(
                intent=intent,
                device_str=device_str,
                target_device=target_device,
                flow_name=flow_name,
                query_lower=query_lower,
                headers=headers,
                active_model=active_model,
                history=payload.messages,
            )
            if local_generator is not None:
                logger.info("Local bypass triggered for intent: %s", intent)
                async for chunk in local_generator:
                    yield chunk
                return

            if "gemini" in active_model.lower():
                sanitized_prompt, mapping = agent.sanitize_prompt(user_query)
                mapping_json = json.dumps(mapping)
                await agent.app.aupdate_state(config, {
                    "gemini_gate_pending": True,
                    "gemini_gate_type": "standard",
                    "gemini_prompt_preview": sanitized_prompt,
                    "sanitization_mapping": mapping_json,
                    "active_model": active_model
                })
                audit_trail.write_audit_log(thread_id, "gemini_direct_requested", {
                    "model": active_model
                })
                try:
                    import metrics as _m; _m.record_escalation_triggered()
                except Exception: pass
                yield _show_gemini_gate(sanitized_prompt, mapping, False, thread_id)
                return

            inputs = {
                "messages": [{"role": m.role, "content": m.content} for m in payload.messages],
                "intent": intent,
                # The frontend's model dropdown — only affects final-answer
                # synthesis (local_synthesizer_node), never classification
                # (which stays pinned to CLASSIFIER_MODEL, see the
                # classify_intent_with_ollama call above) or tool planning.
                "active_model": active_model,
                "target_devices": [target_device] if target_device else [],
                # Always reset all per-query fields so stale state from previous
                # runs on the same thread never bleeds into the new answer.
                "tool_results": [],
                "final_response": "",
                "retrieved_context": "",
                "retrieval_ambiguous": False,
                "planned_tools": [],
                "approval_status": "not_required",
                "risk_tier": "read_only",
                "local_confidence": "MEDIUM",
                "local_response": "",
                "has_tool_results": False,
                "synth_was_streamed": False,
                "gemini_gate_pending": False,
                "gemini_gate_type": "",
                "gemini_prompt_preview": "",
                "sanitization_mapping": "{}",
            }

            yield "🤖 **NETAct AI Agent started reasoning...**\n\n"

            async for stream_mode, event in agent.app.astream(inputs, config, stream_mode=["updates", "custom"]):
                if stream_mode == "custom":
                    yield event
                    continue
                for node_name, node_update in event.items():
                    if node_name == "intent_router":
                        devices = node_update.get("target_devices", [])
                        yield f"🎯 *Intent: **{node_update.get('intent')}** · Devices: {devices or 'N/A'}*\n\n"
                    elif node_name == "context_retriever":
                        yield "📖 *Retrieved topology and knowledgebase context...*\n\n"
                    elif node_name == "tool_planner":
                        planned = node_update.get("planned_tools", [])
                        if planned:
                            yield f"📋 *Planned: {', '.join(t['name'] for t in planned)}*\n\n"
                    elif node_name == "risk_classifier":
                        yield f"🛡️ *Risk: **{node_update.get('risk_tier')}** · Status: **{node_update.get('approval_status')}***\n\n"
                    elif node_name == "tool_executor_start":
                        yield f"⚡ *Executing {node_update.get('count', 0)} commands...*\n\n"
                    elif node_name == "tool_progress":
                        yield f"⏳ *[{node_update.get('index')}/{node_update.get('total')}] `{node_update.get('command')}`...*\n\n"
                    elif node_name == "tool_executor":
                        yield "✅ *Telemetry collected.*\n\n"
                    elif node_name == "local_synthesizer":
                        yield f"🧠 *Local model (`{active_model}`) synthesizing answer...*\n\n"
                    elif node_name == "gemini_prompt_preparer":
                        yield "🔒 *Gemini prompt prepared and sanitized.*\n\n"

            # Graph ran to END — read final state
            post_state = await agent.app.aget_state(config)

            # Human approval gate interrupt (write actions)
            if post_state.next:
                planned_tools = post_state.values.get("planned_tools", [])
                planned_str = json.dumps(planned_tools, indent=2)
                audit_trail.write_audit_log(thread_id, "approval_gate_reached", {
                    "gate": "human_approval_gate", "planned_tools": planned_tools
                })
                yield (
                    f"### ⚠️ **Approval Required**\n\n"
                    f"The agent proposed to execute the following action:\n"
                    f"```json\n{planned_str}\n```\n\n"
                    f"Reply **`yes`** to execute · **`no`** to decline.\n"
                    f"<!-- ACTION: APPROVAL_REQUIRED, THREAD: {thread_id} -->"
                )
                return

            # Normal completion — yield local answer
            final_ans = post_state.values.get("final_response", "Execution complete.")
            local_confidence = post_state.values.get("local_confidence", "MEDIUM")
            has_tool_results = post_state.values.get("has_tool_results", False)
            synth_was_streamed = post_state.values.get("synth_was_streamed", False)

            audit_trail.write_audit_log(thread_id, "assistant_response", {
                "response": final_ans, "confidence": local_confidence, "has_tool_results": has_tool_results
            })
            # local_synthesizer_node's raw model output is already streamed live
            # token-by-token above (via call_ollama_stream's writer() calls, seen
            # as the "custom" stream-mode events) whenever synth_was_streamed is
            # True. In the plain general_chat case, final_response is that exact
            # same text again with only the CONFIDENCE prefix stripped — yielding
            # it here duplicated every answer verbatim (confirmed live). Only
            # skip the re-yield when something was actually streamed AND nothing
            # new was added on top — the tool-results path (has_tool_results)
            # wraps genuinely new content (health score, proof-of-verification)
            # that was never shown live, and hand-built messages that bypass
            # call_ollama_stream entirely (decline_explain, suggest_healthcheck_for)
            # have synth_was_streamed=False, so this is their only copy.
            if not synth_was_streamed or has_tool_results:
                yield final_ans

            # Escalation offer — appended after local answer
            if local_confidence == "LOW" and not has_tool_results:
                yield (
                    "\n\n---\n"
                    "💡 *Local model answered with **low confidence**. "
                    "Type **`gemini`** to escalate to Gemini API for a better answer.*"
                )
            elif has_tool_results:
                yield (
                    "\n\n---\n"
                    "💡 *Device telemetry answered locally (data stays on-network). "
                    "Type **`gemini`** to request cloud analysis — a strict approval gate will apply.*"
                )

        except Exception as e:
            logger.error("Error in chat_stream_generator: %s", e, exc_info=True)
            yield f"🔴 Server error: {str(e)}"

    return StreamingResponse(chat_stream_generator(), media_type="text/plain")


@app.get("/api/copilot/approvals/pending")
async def list_pending_approvals():
    """Lists all active threads currently interrupted at the human approval gate."""
    import agent
    import sqlite3
    
    pending = []
    try:
        conn = sqlite3.connect(agent.DB_PATH)
        cursor = conn.cursor()
        # Find active checkpoints in SQLite checkpointer DB
        cursor.execute("SELECT DISTINCT thread_id FROM checkpoints")
        thread_ids = [row[0] for row in cursor.fetchall()]
        conn.close()
        
        for t_id in thread_ids:
            config = {"configurable": {"thread_id": t_id}}
            state = await agent.app.aget_state(config)
            if state.next:
                pending.append({
                    "thread_id": t_id,
                    "planned_tools": state.values.get("planned_tools", []),
                    "requested_at": state.values.get("approval_requested_at", 0.0),
                    "target_devices": state.values.get("target_devices", []),
                })
    except Exception as e:
        logger.error("Failed to query SQLite checkpointer: %s", e)

    return pending


@app.post("/api/copilot/approvals/action")
async def approve_action(payload: dict):
    """Resumes an interrupted LangGraph run with approval or rejection."""
    import agent
    thread_id = payload.get("thread_id")
    action = payload.get("action", "reject")  # "approve" or "reject"
    if not thread_id:
        raise HTTPException(status_code=400, detail="thread_id is required")
    config = {"configurable": {"thread_id": thread_id}}
    try:
        state = await agent.app.aget_state(config)
        if not state.next:
            raise HTTPException(status_code=404, detail="No pending approval for this thread")
        approved = action == "approve"
        await agent.app.aupdate_state(
            config,
            {"human_approved": approved},
            as_node="human_approval_gate"
        )
        return {"status": "ok", "thread_id": thread_id, "action": action}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error processing approval action: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Benchmark endpoint
# ---------------------------------------------------------------------------

_BENCHMARK_RESULTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "benchmark_results.json")


@app.post("/api/copilot/benchmark")
async def run_benchmark(payload: dict):
    """
    Run intent classifier benchmark for selected groups.
    Body: { "groups": ["G01", "G06"] }  -- omit or pass [] to run all groups.
    Results are saved to benchmark_results.json and returned.
    """
    import benchmark as bm

    group_ids = payload.get("groups") or None  # None = all groups
    if group_ids is not None and not isinstance(group_ids, list):
        raise HTTPException(status_code=400, detail="groups must be a list of group IDs")

    try:
        results = await bm.run_groups(group_ids=group_ids)
        # Persist to disk so results survive page refresh / container restart
        with open(_BENCHMARK_RESULTS_FILE, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        logger.info("Benchmark results saved to %s", _BENCHMARK_RESULTS_FILE)
        import metrics as _metrics
        _metrics.record_benchmark_run(results)
        return results
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"benchmark_cases.json not found: {e}")
    except Exception as e:
        logger.error("Benchmark failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/copilot/benchmark/results")
async def get_last_benchmark_results():
    """Return the most recent benchmark run results from disk, or null if none yet."""
    if not os.path.exists(_BENCHMARK_RESULTS_FILE):
        return None
    try:
        with open(_BENCHMARK_RESULTS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error("Failed to read benchmark_results.json: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/copilot/benchmark/cases")
async def get_benchmark_cases():
    """Return benchmark group metadata so the frontend can show group names and counts."""
    import json as _json
    import os as _os
    cases_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "benchmark_cases.json")
    try:
        with open(cases_path, "r", encoding="utf-8") as f:
            data = _json.load(f)
        groups = [
            {
                "id": g["id"],
                "name": g["name"],
                "intent": g["intent"],
                "case_count": len(g["cases"]),
            }
            for g in data["groups"]
        ]
        return {"version": data.get("version", "1.0"), "groups": groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# ITSM ticket endpoints
# ---------------------------------------------------------------------------

def _itsm_conn():
    import sqlite3
    import agent as _agent
    conn = sqlite3.connect(_agent.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/api/copilot/itsm/tickets")
async def list_itsm_tickets():
    """Return all ITSM change tickets, newest first."""
    import sqlite3
    try:
        conn = _itsm_conn()
        rows = conn.execute(
            "SELECT * FROM itsm_tickets ORDER BY created_at DESC"
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error("list_itsm_tickets error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/copilot/itsm/tickets")
async def create_itsm_ticket(payload: dict):
    """Create a new change ticket with status Pending."""
    import sqlite3, random, string
    device_name = payload.get("device_name", "").strip()
    action_type = payload.get("action_type", "run_config_backup").strip()
    description = payload.get("description", "").strip()
    if not device_name or not description:
        raise HTTPException(status_code=400, detail="device_name and description are required")

    ticket_id = "CHG" + "".join(random.choices(string.digits, k=6))
    try:
        conn = _itsm_conn()
        conn.execute(
            "INSERT INTO itsm_tickets (ticket_id, device_name, action_type, status, description) "
            "VALUES (?, ?, ?, 'Pending', ?)",
            (ticket_id, device_name, action_type, description)
        )
        conn.commit()
        conn.close()
        return {"ticket_id": ticket_id, "status": "Pending"}
    except Exception as e:
        logger.error("create_itsm_ticket error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/api/copilot/itsm/tickets/{ticket_id}/approve")
async def approve_itsm_ticket(ticket_id: str):
    """Set ticket status to Approved."""
    try:
        conn = _itsm_conn()
        cur = conn.execute(
            "UPDATE itsm_tickets SET status='Approved' WHERE ticket_id=?", (ticket_id,)
        )
        conn.commit()
        conn.close()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Ticket {ticket_id} not found")
        return {"ticket_id": ticket_id, "status": "Approved"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/copilot/itsm/tickets/{ticket_id}/reject")
async def reject_itsm_ticket(ticket_id: str):
    """Set ticket status to Rejected."""
    try:
        conn = _itsm_conn()
        cur = conn.execute(
            "UPDATE itsm_tickets SET status='Rejected' WHERE ticket_id=?", (ticket_id,)
        )
        conn.commit()
        conn.close()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Ticket {ticket_id} not found")
        return {"ticket_id": ticket_id, "status": "Rejected"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


