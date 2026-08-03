import os
import time
import glob
import logging
import asyncio
import httpx
import re
import json
import hashlib
import uuid
from concurrent.futures import ProcessPoolExecutor
from pypdf import PdfReader
# Using httpx REST calls instead of QdrantClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("vector-sync")

# CPU-bound PDF parsing and regex metadata extraction must run off the main
# process entirely, not just off the main thread — CPython's GIL means a
# single big re.findall() or pypdf page-parsing call holds the GIL for its
# whole duration regardless of which thread it runs on, which still freezes
# the asyncio event loop (confirmed live: the whole backend, including
# chat and /health, stopped responding for minutes during a large-PDF sync
# even after moving this work to asyncio.to_thread). A real OS process is
# unaffected by the GIL of the main process.
_cpu_pool = ProcessPoolExecutor(max_workers=2)

GIT_REPO_PATH = os.getenv("GIT_REPO_PATH", "/git/repo")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://NETAct_ollama:11434")
QDRANT_URL = os.getenv("QDRANT_HOST", "http://NETAct_qdrant:6333")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
EMBEDDING_NUM_THREAD = int(os.getenv("EMBEDDING_NUM_THREAD", "4"))
COLLECTION_NAME = "netact_knowledgebase"
VAULT_PATH = os.getenv("VAULT_PATH", "/app/obsidian_topology")

REGISTRY_PATH = os.path.join(GIT_REPO_PATH, "knowledgebase", "knowledgebase_registry.json")

# Frontmatter/footer keys whose value is a pure "as of this poll" timestamp,
# not real device content — the brain re-stamps these on every cycle even
# when nothing about the device actually changed. Excluded from the hash so
# a fresh timestamp alone doesn't force a needless re-embed. Deliberately an
# explicit allowlist (not a "last_*" wildcard) — fields like last_backup_status
# and last_run_status hold real state and must still invalidate the hash.
_VOLATILE_TIMESTAMP_KEYS = ("last_import:", "last_healthcheck:", "last_backup_at:", "generated_at:")

def calculate_sha256(filepath: str) -> str:
    """Calculates SHA256 hash of a file, ignoring volatile timestamp-only fields
    (see _VOLATILE_TIMESTAMP_KEYS) and the "Last imported" footer, so re-stamping
    a note with a fresh poll time doesn't alone force a re-embed."""
    hasher = hashlib.sha256()
    try:
        if filepath.endswith('.md'):
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    stripped = line.strip()
                    if "*Last imported:" in line:
                        continue
                    if any(stripped.startswith(k) for k in _VOLATILE_TIMESTAMP_KEYS):
                        continue
                    hasher.update(line.encode('utf-8'))
        else:
            with open(filepath, 'rb') as f:
                for chunk in iter(lambda: f.read(65536), b''):
                    hasher.update(chunk)
        return hasher.hexdigest()
    except Exception as e:
        logger.error(f"Failed to calculate SHA256 for {filepath}: {e}")
        return ""

async def delete_file_points_from_qdrant(filename: str):
    """Deletes vectors associated with a specific file from Qdrant."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            resp = await http_client.post(
                f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points/delete",
                json={"filter": {"must": [{"key": "filename", "match": {"value": filename}}]}}
            )
            resp.raise_for_status()
        logger.info(f"Deleted points for {filename} from Qdrant.")
    except Exception as e:
        logger.error(f"Failed to delete points for {filename} from Qdrant: {e}")

async def ensure_collection_exists(vector_dim: int):
    """Checks if Qdrant collection exists; creates it if missing."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            resp = await http_client.get(f"{QDRANT_URL}/collections/{COLLECTION_NAME}")
            if resp.status_code == 200:
                logger.info(f"Qdrant collection {COLLECTION_NAME} already exists.")
                return True
            
            logger.info(f"Creating new Qdrant collection: {COLLECTION_NAME}")
            resp = await http_client.put(
                f"{QDRANT_URL}/collections/{COLLECTION_NAME}",
                json={
                    "vectors": {
                        "size": vector_dim,
                        "distance": "Cosine"
                    }
                }
            )
            resp.raise_for_status()
            logger.info(f"Created Qdrant collection: {COLLECTION_NAME}")
            return True
    except Exception as e:
        logger.error(f"Failed to ensure Qdrant collection exists: {e}")
        raise

# Vault sub-folders to index (only human-authored notes, not plugin/graphify output)
_VAULT_INDEX_FOLDERS = (
    "Devices", "HealthChecks", "Topology", "Sites", "Inventory", "EOL",
    "Protocols", "Services", "Incidents", "RCA", "AI",
    "SOP", "Workflows", "Changes", "Monitoring",
)
# Folders and paths to skip entirely
_VAULT_SKIP_PATTERNS = (".obsidian", "graphify-out", "plugins", "__pycache__")

def load_registry() -> dict:
    if os.path.exists(REGISTRY_PATH):
        try:
            with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading metadata registry: {e}")
    return {}

def save_registry(registry: dict):
    try:
        with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
            json.dump(registry, f, indent=2)
        logger.info(f"Saved metadata registry to {REGISTRY_PATH}")
    except Exception as e:
        logger.error(f"Error saving metadata registry: {e}")

def remove_document_from_registry(filename: str):
    registry = load_registry()
    if filename in registry:
        registry.pop(filename)
        save_registry(registry)
        logger.info(f"Removed {filename} from metadata registry.")

def _extract_local_metadata_sync(full_text: str) -> tuple[list, set]:
    """Regex-heavy, CPU-bound scan over the full document text — call via
    _cpu_pool (ProcessPoolExecutor), not asyncio.to_thread: the GIL means a
    thread doesn't help here. For a multi-megabyte PDF (whole document concatenated
    into full_text) these re.findall passes, especially the per-CLI-line
    nested loop, took long enough running inline on the event loop to freeze
    every other request (chat, health, everything) for seconds at a time —
    confirmed live via HTTP requests timing out mid-sync."""
    p1 = r'\b(?:ISP|ES|WAC|KTC|KTR|WBC|DR|PE|P|RR|SW|CE|OLT|BNG)[-_][a-zA-Z0-9_-]+\b|\b(?:ISP|ES|WAC|KTC|KTR|WBC|DR|PE|P|RR|SW|CE|OLT|BNG)\d+\b|\b(?:DB|CSM|MCSM|ACSM|OMI|VPP)\d+\b'
    m1 = set(re.findall(p1, full_text, re.IGNORECASE))

    # Prompt-based pattern (e.g. [local]R6675-MAQUETA-MENOS2#)
    p2 = r'\b([a-zA-Z0-9_-]{3,})(?:\([^)]+\))?[#>]'
    m2 = set(re.findall(p2, full_text))

    # Generic R-series pattern (e.g. R6675, R6000)
    p3 = r'\bR\d+(?:[-_][a-zA-Z0-9_-]+)?\b'
    m3 = set(re.findall(p3, full_text, re.IGNORECASE))

    devices = m1 | m2 | m3
    devices_list = sorted(list(set(d.lower() for d in devices)))

    # 2. Extract command/script keywords locally
    command_patterns = re.findall(r'\b[a-z]{3,}(?:ctl|sh|cfg|diag|check)\b|\b[a-z]{3,}-[a-z]{3,}\b', full_text.lower())
    local_keywords = set(command_patterns)

    # Extract words from CLI commands following prompts (e.g. show, circuit, counters, vlan, detail)
    cli_lines = re.findall(r'(?:#|>)\s*([a-zA-Z][a-zA-Z0-9_\-\s]{3,})', full_text)
    for line in cli_lines:
        for w in re.findall(r'\b[a-zA-Z]{3,}\b', line.lower()):
            local_keywords.add(w)

    return devices_list, local_keywords

async def extract_metadata(filename: str, full_text: str) -> dict:
    loop = asyncio.get_running_loop()
    devices_list, local_keywords = await loop.run_in_executor(_cpu_pool, _extract_local_metadata_sync, full_text)

    # 3. LLM pass on the snippet of the document to get covered topics and terms
    llm_keywords = []
    llm_topics = []
    
    ollama_model = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:0.5b")
    prompt = (
        "You are a documentation metadata extractor.\n"
        "Analyze the document intro/text snippet below and extract:\n"
        "1. Unique technical/network keywords, acronyms, or commands (e.g. crsctl, backup, cabling).\n"
        "2. Short phrases of topics covered (e.g. RAC database health, BGP routing configuration).\n\n"
        "Respond ONLY with a JSON object in this format:\n"
        "{\"keywords\": [\"kw1\", \"kw2\"], \"topics\": [\"topic1\"]}\n\n"
        f"Snippet:\n{full_text[:2000]}\n"
    )
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/generate",
                json={
                    "model": ollama_model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.0, "num_predict": 128}
                }
            )
            if resp.status_code == 200:
                content = resp.json().get("response", "").strip()
                match = re.search(r"\{[\s\S]*?\}", content)
                if match:
                    parsed = json.loads(match.group(0))
                    llm_keywords = [k.lower().strip() for k in parsed.get("keywords", []) if len(k) > 2]
                    llm_topics = [t.lower().strip() for t in parsed.get("topics", [])]
    except Exception as e:
        logger.error(f"Failed LLM metadata extraction for {filename}: {e}")
        
    all_keywords = set(devices_list) | local_keywords | set(llm_keywords)
    stopwords = {
        "the", "and", "for", "with", "that", "this", "these", "those", "from", "your", "will", 
        "have", "has", "had", "been", "was", "were", "are", "document", "file", "page", "section"
    }
    cleaned_keywords = sorted(list(set(k for k in all_keywords if k not in stopwords and len(k) > 2)))
    
    return {
        "devices": devices_list,
        "keywords": cleaned_keywords,
        "topics": llm_topics
    }

async def get_embedding(text: str, rate_limit: bool = False) -> list[float]:
    """Generates text embedding using configured local Ollama embedding model.

    rate_limit=True adds a 100ms sleep before the call — use during bulk sync
    to avoid saturating Ollama and leaving no CPU for chat inference.
    """
    if rate_limit:
        await asyncio.sleep(0.1)
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            # Try /api/embeddings (prompt) or /api/embed (input)
            try:
                resp = await client.post(
                    f"{OLLAMA_HOST}/api/embeddings",
                    json={"model": EMBEDDING_MODEL, "prompt": text, "options": {"num_thread": EMBEDDING_NUM_THREAD}}
                )
                resp.raise_for_status()
                return resp.json()["embedding"]
            except Exception:
                resp = await client.post(
                    f"{OLLAMA_HOST}/api/embed",
                    json={"model": EMBEDDING_MODEL, "input": text, "options": {"num_thread": EMBEDDING_NUM_THREAD}}
                )
                resp.raise_for_status()
                # Newer endpoint returns "embeddings" (list of lists)
                res_data = resp.json()
                if "embeddings" in res_data and res_data["embeddings"]:
                    return res_data["embeddings"][0]
                elif "embedding" in res_data:
                    return res_data["embedding"]
                raise
    except Exception as e:
        logger.warning(f"Failed to generate embedding via Ollama (model: {EMBEDDING_MODEL}): {e}. Returning dummy vector.")
        dim = 1024 if "bge-m3" in EMBEDDING_MODEL.lower() else (768 if "nomic" in EMBEDDING_MODEL.lower() else 384)
        return [0.0] * dim

def _extract_pages_sync(filepath: str, is_pdf: bool) -> list[tuple[int, str]]:
    """Synchronous PDF/text extraction — call via _cpu_pool (ProcessPoolExecutor),
    never directly on the event loop or a plain thread (CPU-bound, can take
    minutes on large PDFs, and holds the GIL the whole time in a thread)."""
    if is_pdf:
        reader = PdfReader(filepath)
        pages_data = []
        for page_num, page in enumerate(reader.pages):
            text = page.extract_text()
            if not text or not text.strip():
                continue
            pages_data.append((page_num, text))
        return pages_data
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    return [(0, text)] if text.strip() else []

def chunk_text(text: str, chunk_size=350, overlap=50) -> list[str]:
    """Chunks text into small overlapping fragments for semantic embedding."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks

async def sync_git_knowledgebase() -> int:
    """Reads PDFs and text files from /git/repo/knowledgebase, extracts metadata, and uploads to Qdrant incrementally.

    This is the path PDF/doc uploads via the frontend actually go through
    (/api/copilot/documents/upload -> this function) — a separate pipeline
    from sync_vault_notes() (Obsidian vault notes). Both feed the same Qdrant
    collection, but neither touches the other's source files, and neither
    goes through NETAct_brain — Brain only ever writes into the Obsidian
    vault (VAULT_PATH), never into GIT_REPO_PATH/knowledgebase.
    """
    from metrics import (
        sync_total_chunks, sync_success_chunks, sync_failed_chunks,
        sync_estimated_time_remaining, sync_completion_percentage
    )

    kb_path = os.path.join(GIT_REPO_PATH, "knowledgebase")
    if not os.path.isdir(kb_path):
        os.makedirs(kb_path, exist_ok=True)
        logger.info(f"Created empty knowledgebase directory at {kb_path}")
        return 0

    # 1. Get a sample embedding to dynamically detect vector dimensions
    try:
        sample_vector = await get_embedding("test")
        vector_dim = len(sample_vector)
        logger.info(f"Detected embedding dimension size: {vector_dim} using model '{EMBEDDING_MODEL}'")
    except Exception as e:
        logger.error(f"Failed to generate sample embedding from Ollama model '{EMBEDDING_MODEL}': {e}")
        return 0

    # Ensure collection exists instead of deleting/recreating it
    try:
        await ensure_collection_exists(vector_dim)
    except Exception as e:
        logger.error(f"Failed to ensure Qdrant collection: {e}")
        return 0

    old_registry = load_registry()
    new_registry = {}

    # Preserve vault notes registry entries so they aren't deleted as orphans
    for fname, meta in old_registry.items():
        if meta.get("source") == "vault_notes":
            new_registry[fname] = meta

    # 2. Pre-scan changed/new files and extract their text up front, so the
    # total chunk count (for progress %) is known before embedding starts —
    # same approach sync_vault_notes() uses.
    pdf_paths = glob.glob(os.path.join(kb_path, "**/*.pdf"), recursive=True)
    text_paths = [
        p for p in (
            glob.glob(os.path.join(kb_path, "**/*.txt"), recursive=True) +
            glob.glob(os.path.join(kb_path, "**/*.md"), recursive=True)
        )
        if os.path.basename(p) != "knowledgebase_registry.json"
    ]

    file_extract_map = {}  # filepath -> (is_pdf, file_hash, [(page_num, text), ...])
    total_chunks = 0
    for filepath in pdf_paths + text_paths:
        filename = os.path.basename(filepath)
        # calculate_sha256 and PdfReader/extract_text are synchronous,
        # CPU-bound calls. Running them directly on the event loop froze the
        # ENTIRE backend — every endpoint, including chat and /health — for
        # as long as a large PDF's pre-scan took (confirmed live: 100% CPU,
        # zero HTTP responses of any kind for minutes on a 23MB/multi-
        # thousand-page file). asyncio.to_thread alone didn't fix it either —
        # the GIL means one big synchronous call still blocks the event loop
        # thread regardless of which thread runs it. _cpu_pool is a real
        # separate OS process, immune to the main process's GIL.
        loop = asyncio.get_running_loop()
        file_hash = await loop.run_in_executor(_cpu_pool, calculate_sha256, filepath)
        if filename in old_registry and old_registry[filename].get("hash") == file_hash:
            new_registry[filename] = old_registry[filename]
            continue

        is_pdf = filepath in pdf_paths
        try:
            pages_data = await loop.run_in_executor(_cpu_pool, _extract_pages_sync, filepath, is_pdf)
        except Exception as e:
            logger.error(f"Failed to read {filename} during pre-scan: {e}")
            pages_data = []

        if not pages_data:
            continue
        file_extract_map[filepath] = (is_pdf, file_hash, pages_data)
        for _, text in pages_data:
            total_chunks += len(chunk_text(text))

    sync_total_chunks.set(total_chunks)
    sync_success_chunks.set(0)
    sync_failed_chunks.set(0)
    sync_completion_percentage.set(0.0 if total_chunks else 100.0)
    sync_estimated_time_remaining.set(0.0)

    processed_chunks = 0
    sync_start_time = time.time()

    def _update_progress(delta: int, failed: bool = False):
        nonlocal processed_chunks
        processed_chunks += delta
        if failed:
            sync_failed_chunks.inc(delta)
        else:
            sync_success_chunks.inc(delta)
        if total_chunks > 0:
            pct = min(100.0, (processed_chunks / total_chunks) * 100.0)
            sync_completion_percentage.set(pct)
            elapsed = time.time() - sync_start_time
            if processed_chunks > 0:
                rate = processed_chunks / elapsed
                remaining = total_chunks - processed_chunks
                sync_estimated_time_remaining.set(remaining / rate if rate > 0 else 0)

    async def _upload_batch(points: list, label: str):
        if not points:
            return
        try:
            async with httpx.AsyncClient(timeout=120.0) as http_client:
                for i in range(0, len(points), 100):
                    batch = points[i:i+100]
                    resp = await http_client.put(
                        f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points?wait=true",
                        json={"points": batch}
                    )
                    resp.raise_for_status()
            logger.info(f"Uploaded {len(points)} points to Qdrant for {label}.")
        except Exception as e:
            logger.error(f"Failed to upload points to Qdrant for {label}: {e}")

    # 3. Process each changed/new file using its pre-extracted text — and
    # flush points to Qdrant every UPLOAD_BATCH_SIZE chunks instead of
    # buffering an entire file in memory. A single large PDF (thousands of
    # chunks, embedded one at a time on CPU-only Ollama) can take tens of
    # minutes by itself; waiting for the whole file meant nothing became
    # visible/searchable in Qdrant until that one file finished, even though
    # embedding was actively progressing the whole time. Flushing every 50
    # chunks makes points show up in Qdrant within seconds of being embedded,
    # and caps how much work is lost if the container restarts mid-file.
    UPLOAD_BATCH_SIZE = 50
    total_uploaded = 0
    for filepath in file_extract_map:
        filename = os.path.basename(filepath)
        is_pdf, file_hash, pages_data = file_extract_map[filepath]
        logger.info(f"Processing changed/new file: {filename}")

        if filename in old_registry:
            await delete_file_points_from_qdrant(filename)

        pending_points = []
        file_point_count = 0
        try:
            full_text = "\n".join(text for _, text in pages_data)
            metadata = await extract_metadata(filename, full_text)

            for page_num, text in pages_data:
                chunks = chunk_text(text)
                for chunk_idx, chunk in enumerate(chunks):
                    vector = await get_embedding(chunk)
                    is_dummy = all(v == 0.0 for v in vector)
                    _update_progress(1, failed=is_dummy)
                    pending_points.append({
                        "id": str(uuid.uuid4()),
                        "vector": vector,
                        "payload": {
                            "filename": filename,
                            "source": "knowledgebase",
                            "page": (page_num + 1) if is_pdf else 1,
                            "chunk_index": chunk_idx,
                            "text": chunk
                        }
                    })
                    if len(pending_points) >= UPLOAD_BATCH_SIZE:
                        await _upload_batch(pending_points, filename)
                        file_point_count += len(pending_points)
                        pending_points = []

            await _upload_batch(pending_points, filename)
            file_point_count += len(pending_points)
            total_uploaded += file_point_count
            new_registry[filename] = {**metadata, "hash": file_hash, "source": "knowledgebase"}
            save_registry(new_registry)
        except Exception as e:
            logger.error(f"Failed to process {filename}: {e}")
            chunk_count = sum(len(chunk_text(t)) for _, t in pages_data)
            _update_progress(chunk_count, failed=True)

    # Vault notes are synced separately via /api/copilot/sync-vault
    # to avoid saturating Ollama during KB file sync.

    # Delete points for files that are no longer on filesystem
    for filename in old_registry:
        if filename not in new_registry:
            logger.info(f"File {filename} deleted from filesystem. Purging vectors from Qdrant.")
            await delete_file_points_from_qdrant(filename)

    sync_completion_percentage.set(100.0)
    sync_estimated_time_remaining.set(0.0)

    # Save the compiled registry file (already saved incrementally above per
    # file; this final save also captures the orphan-deletion pass)
    save_registry(new_registry)
    logger.info(f"Knowledgebase sync completed. New points uploaded: {total_uploaded}")
    return total_uploaded

async def sync_vault_notes(old_registry: dict, new_registry: dict, points_list: list) -> int:
    """Indexes Obsidian vault markdown notes from VAULT_PATH into Qdrant incrementally."""
    if not os.path.isdir(VAULT_PATH):
        logger.warning("Vault path not found, skipping vault note indexing: %s", VAULT_PATH)
        return 0

    from metrics import (
        sync_total_chunks, sync_success_chunks, sync_failed_chunks,
        sync_estimated_time_remaining, sync_completion_percentage
    )

    total_uploaded = 0
    # Concurrency limit for Ollama. Per-call thread count (EMBEDDING_NUM_THREAD)
    # stays low so each individual embedding call is cheap; this controls how many
    # run in parallel. Raise to use idle cores during a bulk backlog catch-up,
    # dial back down toward steady state to leave headroom for concurrent chat.
    sem = asyncio.Semaphore(int(os.getenv("EMBEDDING_CONCURRENCY", "4")))

    # 1. Pre-scan to count files and chunks
    file_list = []
    for folder in _VAULT_INDEX_FOLDERS:
        folder_path = os.path.join(VAULT_PATH, folder)
        if not os.path.isdir(folder_path):
            continue
        for filepath in glob.glob(os.path.join(folder_path, "**/*.md"), recursive=True):
            rel = os.path.relpath(filepath, VAULT_PATH)
            if any(skip in rel.replace("\\", "/") for skip in _VAULT_SKIP_PATTERNS):
                continue
            filename = os.path.basename(filepath)
            file_hash = calculate_sha256(filepath)
            if filename in old_registry and old_registry[filename].get("hash") == file_hash:
                new_registry[filename] = old_registry[filename]
                continue
            file_list.append((filepath, folder))

    # Pre-calculate chunk counts to get total_chunks
    total_chunks = 0
    file_chunks_map = {}
    for filepath, folder in file_list:
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
            body = re.sub(r'^---[\s\S]*?---\s*', '', text, count=1).strip()
            if not body:
                body = text.strip()
            chunks = chunk_text(body)
            file_chunks_map[filepath] = chunks
            total_chunks += len(chunks)
        except Exception:
            file_chunks_map[filepath] = []

    # Initialize metrics
    sync_total_chunks.set(total_chunks)
    sync_success_chunks.set(0)
    sync_failed_chunks.set(0)
    sync_completion_percentage.set(0.0)
    sync_estimated_time_remaining.set(0.0)

    if total_chunks == 0:
        sync_completion_percentage.set(100.0)
        return 0

    sync_start_time = time.time()
    processed_chunks = 0
    processed_lock = asyncio.Lock()

    async def update_progress(success_delta, failed_delta):
        nonlocal processed_chunks
        async with processed_lock:
            processed_chunks += success_delta + failed_delta
            if success_delta > 0:
                sync_success_chunks.inc(success_delta)
            if failed_delta > 0:
                sync_failed_chunks.inc(failed_delta)
            
            if total_chunks > 0:
                pct = min(100.0, (processed_chunks / total_chunks) * 100.0)
                sync_completion_percentage.set(pct)
                
                elapsed = time.time() - sync_start_time
                if processed_chunks > 0:
                    rate = processed_chunks / elapsed
                    remaining = total_chunks - processed_chunks
                    est_remaining = remaining / rate if rate > 0 else 0
                    sync_estimated_time_remaining.set(est_remaining)

    async def process_file_item(filepath, folder):
        nonlocal total_uploaded
        filename = os.path.basename(filepath)
        file_hash = calculate_sha256(filepath)
        
        # Delete old points
        if filename in old_registry:
            await delete_file_points_from_qdrant(filename)

        try:
            chunks = file_chunks_map.get(filepath, [])
            if not chunks:
                return

            local_points = []
            success_delta = 0
            failed_delta = 0
            
            for chunk_idx, chunk in enumerate(chunks):
                async with sem:
                    vector = await get_embedding(chunk, rate_limit=False)
                
                # Check if it returned dummy vector
                is_dummy = all(v == 0.0 for v in vector)
                if is_dummy:
                    failed_delta += 1
                else:
                    success_delta += 1

                local_points.append({
                    "id": str(uuid.uuid4()),
                    "vector": vector,
                    "payload": {
                        "filename": filename,
                        "vault_folder": folder,
                        "source": "vault_notes",
                        "page": chunk_idx + 1,
                        "chunk_index": chunk_idx,
                        "text": chunk,
                    }
                })

            if local_points:
                points_list.extend(local_points)
                total_uploaded += len(local_points)

            new_registry[filename] = {
                "source": "vault_notes",
                "vault_folder": folder,
                "filepath": os.path.relpath(filepath, VAULT_PATH),
                "hash": file_hash,
            }

            await update_progress(success_delta, failed_delta)

        except Exception as e:
            logger.error("Failed to process vault note %s: %s", filepath, e)
            chunks_len = len(file_chunks_map.get(filepath, []))
            await update_progress(0, chunks_len)

    tasks = []
    for filepath, folder in file_list:
        tasks.append(process_file_item(filepath, folder))

    if tasks:
        # Process tasks in bounded batches to prevent queue buildup and timeouts
        batch_size = 15
        for i in range(0, len(tasks), batch_size):
            batch = tasks[i:i+batch_size]
            await asyncio.gather(*batch)

    # Set final completed state
    sync_completion_percentage.set(100.0)
    sync_estimated_time_remaining.set(0.0)
    return total_uploaded

async def sync_vault_notes_standalone() -> int:
    """Standalone incremental vault-notes sync — runs independently of the KB file sync."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            resp = await http_client.get(f"{QDRANT_URL}/collections/{COLLECTION_NAME}")
            if resp.status_code != 200:
                logger.warning("Collection %s not found — run KB sync first", COLLECTION_NAME)
                return 0
    except Exception as e:
        logger.error("Failed to check collection status for standalone vault sync: %s", e)
        return 0

    old_registry = load_registry()
    new_registry = {}
    points_to_upload: list = []

    # 1. Populate new_registry for KB files (so they don't get deleted as orphans)
    for fname, meta in old_registry.items():
        if meta.get("source") != "vault_notes":
            new_registry[fname] = meta

    # 2. Sync vault notes incrementally
    chunks_added = await sync_vault_notes(
        old_registry=old_registry,
        new_registry=new_registry,
        points_list=points_to_upload,
    )

    # 3. Clean up deleted vault notes from Qdrant
    for fname, meta in old_registry.items():
        if meta.get("source") == "vault_notes" and fname not in new_registry:
            logger.info(f"Vault note {fname} deleted from filesystem. Purging vectors from Qdrant.")
            await delete_file_points_from_qdrant(fname)

    # 4. Upload new points
    if points_to_upload:
        try:
            async with httpx.AsyncClient(timeout=120.0) as http_client:
                for i in range(0, len(points_to_upload), 100):
                    batch = points_to_upload[i:i+100]
                    resp = await http_client.put(
                        f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points?wait=true",
                        json={"points": batch}
                    )
                    resp.raise_for_status()
            logger.info("Vault sync complete: uploaded %d chunks to Qdrant", len(points_to_upload))
        except Exception as e:
            logger.error("Failed to upload vault note vectors: %s", e)

    save_registry(new_registry)
    return chunks_added
