from fastapi import FastAPI, HTTPException, UploadFile, File, Response, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import pandas as pd
import numpy as np
import os
import json
import shutil
import datetime
import subprocess
import traceback
import io
import threading

app = FastAPI(title="NETAct Git ODF API", version="1.0")

# Enable CORS so odf_dashboard_app (port 5000) can make API calls securely
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5000", "http://127.0.0.1:5000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths inside Docker container
GIT_REPO_PATH = "/git/repo"
EXCEL_FILE = "/app/data/Master.xlsx"  # Kept as fallback bootstrap uploader source
BACKUP_DIR = "/git/repo/backups"      # Backup folder inside Git volume

# Ensure directories exist
os.makedirs(BACKUP_DIR, exist_ok=True)

MAX_BACKUPS = 5
DB_LOCK = threading.Lock()

# Global in-memory cache
CACHE_CONN = None
CACHE_PORTS = None

def safe_name(name):
    """Sanitize names to be safe for file system paths"""
    if name is None or pd.isna(name):
        return "Unspecified"
    name_str = str(name).strip()
    if not name_str:
        return "Unspecified"
    safe = "".join(c if c not in "/\\:*?\"<>|" else "_" for c in name_str)
    return safe.strip()

def git_commit_changes(message):
    """Run Git configuration and commit ODF changes inside the repository container"""
    try:
        if not os.path.exists(GIT_REPO_PATH):
            return False
            
        if not os.path.exists(os.path.join(GIT_REPO_PATH, ".git")):
            subprocess.run(["git", "init"], cwd=GIT_REPO_PATH, capture_output=True)
            
        subprocess.run(["git", "config", "user.name", "ODF Dashboard"], cwd=GIT_REPO_PATH, capture_output=True)
        subprocess.run(["git", "config", "user.email", "odf-dashboard@local"], cwd=GIT_REPO_PATH, capture_output=True)
        
        subprocess.run(["git", "add", "odf/"], cwd=GIT_REPO_PATH, capture_output=True)
        res = subprocess.run(["git", "commit", "-m", message], cwd=GIT_REPO_PATH, capture_output=True, text=True)
        print(f"Git commit output: {res.stdout.strip()}")
        return True
    except Exception as e:
        print(f"Git commit failed: {e}")
        return False

def create_backup():
    """Create timestamped zip backup of ODF git database directory with rotation"""
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        odf_base_dir = os.path.join(GIT_REPO_PATH, "odf")
        if not os.path.exists(odf_base_dir):
            return False
            
        backup_zip = os.path.join(BACKUP_DIR, f"ODF_Git_Backup_{timestamp}")
        shutil.make_archive(backup_zip, 'zip', odf_base_dir)
        
        # Rotational cleaning of old backups
        backups = sorted([f for f in os.listdir(BACKUP_DIR) if f.startswith("ODF_Git_Backup_")])
        while len(backups) > MAX_BACKUPS:
            os.remove(os.path.join(BACKUP_DIR, backups[0]))
            backups.pop(0)
        return True
    except Exception as e:
        print(f"Backup failed: {e}")
        return False

def handle_nan(value):
    """Convert pandas/numpy types to Python native types, handling datetimes and timestamps"""
    if pd.isna(value):
        return None
    if isinstance(value, (np.integer, np.floating)):
        return int(value) if isinstance(value, np.integer) else float(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    return str(value) if isinstance(value, (np.str_, np.object_)) else value

def json_compatible(obj):
    """Recursively clean an object to ensure it is JSON compliant (no float NaN/Inf)"""
    if isinstance(obj, dict):
        return {k: json_compatible(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [json_compatible(v) for v in obj]
    elif isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return obj
    elif pd.isna(obj):
        return None
    return obj

def bootstrap_from_excel():
    """Loads the spreadsheet and performs one-time bootstrap to Git directory layout"""
    try:
        if not os.path.exists(EXCEL_FILE):
            print(f"Excel bootstrap file not found at: {EXCEL_FILE}")
            return False
            
        print(f"Performing one-time bootstrap migration from {EXCEL_FILE}...")
        df_conn = pd.read_excel(EXCEL_FILE, sheet_name="ODF Connections", engine='openpyxl')
        df_ports = pd.read_excel(EXCEL_FILE, sheet_name="ODF Port Details", engine='openpyxl')
        
        if "ODF No." not in df_ports.columns and "ODF POS" in df_ports.columns:
            print("Renaming ODF POS column in Port Details to ODF No. for compatibility...")
            df_ports = df_ports.rename(columns={"ODF POS": "ODF No."})
        
        if hasattr(df_conn, 'map'):
            df_conn = df_conn.map(handle_nan)
            df_ports = df_ports.map(handle_nan)
        else:
            df_conn = df_conn.applymap(handle_nan)
            df_ports = df_ports.applymap(handle_nan)
        
        save_data_to_git(df_conn, df_ports, commit_message="One-time automatic bootstrap migration from Excel")
        print("Bootstrap migration completed successfully!")
        return True
    except Exception as e:
        print(f"Bootstrap migration failed: {e}")
        traceback.print_exc()
        return False

def load_data():
    """Loads connections and ports from the Git file-system database recursively with caching and self-healing"""
    global CACHE_CONN, CACHE_PORTS
    
    if CACHE_CONN is not None and CACHE_PORTS is not None:
        return CACHE_CONN.copy(), CACHE_PORTS.copy()
        
    with DB_LOCK:
        # Re-check inside lock
        if CACHE_CONN is not None and CACHE_PORTS is not None:
            return CACHE_CONN.copy(), CACHE_PORTS.copy()
            
        try:
            odf_base_dir = os.path.join(GIT_REPO_PATH, "odf")
            consolidated_conn = os.path.join(odf_base_dir, "connections.json")
            consolidated_ports = os.path.join(odf_base_dir, "ports.json")
            
            # 1. Instant loading from consolidated cache files (under 200ms)
            if os.path.exists(consolidated_conn) and os.path.exists(consolidated_ports):
                print("Loading ODF database from consolidated cache files...")
                try:
                    with open(consolidated_conn, "r", encoding="utf-8") as f:
                        conn_list = json.load(f)
                    with open(consolidated_ports, "r", encoding="utf-8") as f:
                        ports_list = json.load(f)
                        
                    df_conn = pd.DataFrame(conn_list) if conn_list else pd.DataFrame(columns=["Data Center", "Room Number", "ODF No."])
                    df_ports = pd.DataFrame(ports_list) if ports_list else pd.DataFrame(columns=["ODF No.", "Port No."])
                    
                    if hasattr(df_conn, 'map'):
                        df_conn = df_conn.map(handle_nan)
                        df_ports = df_ports.map(handle_nan)
                    else:
                        df_conn = df_conn.applymap(handle_nan)
                        df_ports = df_ports.applymap(handle_nan)
                        
                    if all(col in df_conn.columns for col in ["ODF No.", "Sheet Name"]) and "ODF No." in df_ports.columns:
                        sheet_mapping = df_conn[["ODF No.", "Sheet Name"]].drop_duplicates(subset=["ODF No."])
                        df_ports = pd.merge(df_ports, sheet_mapping, on="ODF No.", how="left")
                        
                    df_conn["__rowid__"] = range(len(df_conn))
                    df_ports["__rowid__"] = range(len(df_ports))
                    
                    CACHE_CONN = df_conn.copy()
                    CACHE_PORTS = df_ports.copy()
                    print(f"ODF Cache loaded instantly from consolidated files. Connections: {len(df_conn)}, Ports: {len(df_ports)}")
                    return df_conn, df_ports
                except Exception as ex:
                    print(f"Failed to load consolidated cache, falling back to directory traversal: {ex}")
            
            # 2. Directory traversal fallback if consolidated files are missing
            if not os.path.exists(odf_base_dir) or not os.listdir(odf_base_dir):
                if not bootstrap_from_excel():
                    return pd.DataFrame(), pd.DataFrame()
                    
            conn_list = []
            ports_list = []
            
            for root, dirs, files in os.walk(odf_base_dir):
                for file in files:
                    if file == "connections.json" and root != odf_base_dir:
                        conn_file = os.path.join(root, file)
                        try:
                            with open(conn_file, "r", encoding="utf-8") as f:
                                conn_data = json.load(f)
                                if isinstance(conn_data, list):
                                    conn_list.extend(conn_data)
                        except Exception as e:
                            print(f"Error reading {conn_file}: {e}")
                    elif file == "ports.json" and root != odf_base_dir:
                        ports_file = os.path.join(root, file)
                        try:
                            with open(ports_file, "r", encoding="utf-8") as f:
                                ports_data = json.load(f)
                                if isinstance(ports_data, list):
                                    ports_list.extend(ports_data)
                        except Exception as e:
                            print(f"Error reading {ports_file}: {e}")
                                
            df_conn = pd.DataFrame(conn_list) if conn_list else pd.DataFrame(columns=["Data Center", "Room Number", "ODF No."])
            df_ports = pd.DataFrame(ports_list) if ports_list else pd.DataFrame(columns=["ODF No.", "Port No."])
            
            if hasattr(df_conn, 'map'):
                df_conn = df_conn.map(handle_nan)
                df_ports = df_ports.map(handle_nan)
            else:
                df_conn = df_conn.applymap(handle_nan)
                df_ports = df_ports.applymap(handle_nan)
            
            if all(col in df_conn.columns for col in ["ODF No.", "Sheet Name"]) and "ODF No." in df_ports.columns:
                sheet_mapping = df_conn[["ODF No.", "Sheet Name"]].drop_duplicates(subset=["ODF No."])
                df_ports = pd.merge(df_ports, sheet_mapping, on="ODF No.", how="left")
                
            df_conn["__rowid__"] = range(len(df_conn))
            df_ports["__rowid__"] = range(len(df_ports))
            
            # Store in global cache
            CACHE_CONN = df_conn.copy()
            CACHE_PORTS = df_ports.copy()
            print(f"ODF Cache loaded successfully via traversal. Connections: {len(df_conn)}, Ports: {len(df_ports)}")
            
            # 3. Self-healing: write the consolidated files now so all future boots are instant
            try:
                os.makedirs(odf_base_dir, exist_ok=True)
                df_conn_save = df_conn.drop(columns=["__rowid__"], errors="ignore")
                df_ports_save = df_ports.drop(columns=["__rowid__", "Sheet Name"], errors="ignore")
                
                conn_all_records = df_conn_save.to_dict(orient="records")
                conn_all_records = [{k: handle_nan(v) for k, v in r.items()} for r in conn_all_records]
                with open(consolidated_conn, "w", encoding="utf-8") as f:
                    json.dump(conn_all_records, f, indent=2, ensure_ascii=False)
                    
                ports_all_records = df_ports_save.to_dict(orient="records")
                ports_all_records = [{k: handle_nan(v) for k, v in r.items()} for r in ports_all_records]
                with open(consolidated_ports, "w", encoding="utf-8") as f:
                    json.dump(ports_all_records, f, indent=2, ensure_ascii=False)
                print("Consolidated index files successfully self-healed at volume root!")
            except Exception as se:
                print(f"Self-healing write failed: {se}")
                
            return df_conn, df_ports
        except Exception as e:
            print(f"Error loading ODF database: {e}")
            traceback.print_exc()
            return pd.DataFrame(), pd.DataFrame()

def save_data_to_git(df_conn, df_ports, commit_message="ODF database updated"):
    """Atomically commits updated connections and ports records to local file-system Git structure"""
    global CACHE_CONN, CACHE_PORTS
    
    with DB_LOCK:
        try:
            create_backup()
            odf_base_dir = os.path.join(GIT_REPO_PATH, "odf")
            odf_tmp_dir = os.path.join(GIT_REPO_PATH, "odf_tmp")
            
            if os.path.exists(odf_tmp_dir):
                shutil.rmtree(odf_tmp_dir)
            os.makedirs(odf_tmp_dir, exist_ok=True)
            
            df_conn_save = df_conn.drop(columns=["__rowid__"], errors="ignore")
            df_ports_save = df_ports.drop(columns=["__rowid__"], errors="ignore")
            df_ports_save = df_ports_save.drop(columns=["Sheet Name"], errors="ignore")
            
            odf_location = {}
            
            # 1. Group and write connections
            grouped_conn = df_conn_save.groupby(["Data Center", "Room Number", "ODF No."], dropna=False)
            for (dc, room, odf), group in grouped_conn:
                dc_str = str(dc) if not pd.isna(dc) else "Unspecified"
                room_str = str(room) if not pd.isna(room) else "Unspecified"
                odf_str = str(odf) if not pd.isna(odf) else "Unspecified"
                
                if odf_str != "Unspecified":
                    odf_location[odf_str] = (dc_str, room_str)
                    
                odf_dir = os.path.join(odf_tmp_dir, safe_name(dc_str), safe_name(room_str), safe_name(odf_str))
                os.makedirs(odf_dir, exist_ok=True)
                
                conn_records = group.to_dict(orient="records")
                conn_records = [{k: handle_nan(v) for k, v in r.items()} for r in conn_records]
                
                with open(os.path.join(odf_dir, "connections.json"), "w", encoding="utf-8") as f:
                    json.dump(conn_records, f, indent=2, ensure_ascii=False)
                    
            # 2. Group and write ports
            grouped_ports = df_ports_save.groupby("ODF No.", dropna=False)
            for odf, group in grouped_ports:
                odf_str = str(odf) if not pd.isna(odf) else "Unspecified"
                dc_str, room_str = odf_location.get(odf_str, ("Unspecified", "Unspecified"))
                
                if dc_str == "Unspecified" and not group.empty:
                    first_row = group.iloc[0]
                    if "Data Center" in first_row and not pd.isna(first_row["Data Center"]):
                        dc_str = str(first_row["Data Center"])
                    if "Room Number" in first_row and not pd.isna(first_row["Room Number"]):
                        room_str = str(first_row["Room Number"])
                        
                odf_dir = os.path.join(odf_tmp_dir, safe_name(dc_str), safe_name(room_str), safe_name(odf_str))
                os.makedirs(odf_dir, exist_ok=True)
                
                port_records = group.to_dict(orient="records")
                port_records = [{k: handle_nan(v) for k, v in r.items()} for r in port_records]
                
                with open(os.path.join(odf_dir, "ports.json"), "w", encoding="utf-8") as f:
                    json.dump(port_records, f, indent=2, ensure_ascii=False)
                    
            # 3. Write consolidated index files for ultra-fast startup loading (under 200ms)
            conn_all_records = df_conn_save.to_dict(orient="records")
            conn_all_records = [{k: handle_nan(v) for k, v in r.items()} for r in conn_all_records]
            with open(os.path.join(odf_tmp_dir, "connections.json"), "w", encoding="utf-8") as f:
                json.dump(conn_all_records, f, indent=2, ensure_ascii=False)
                
            ports_all_records = df_ports_save.to_dict(orient="records")
            ports_all_records = [{k: handle_nan(v) for k, v in r.items()} for r in ports_all_records]
            with open(os.path.join(odf_tmp_dir, "ports.json"), "w", encoding="utf-8") as f:
                json.dump(ports_all_records, f, indent=2, ensure_ascii=False)
                
            # Atomic layout replacement
            odf_old_dir = os.path.join(GIT_REPO_PATH, "odf_old")
            if os.path.exists(odf_old_dir):
                shutil.rmtree(odf_old_dir)
                
            if os.path.exists(odf_base_dir):
                os.rename(odf_base_dir, odf_old_dir)
                
            os.rename(odf_tmp_dir, odf_base_dir)
            
            if os.path.exists(odf_old_dir):
                shutil.rmtree(odf_old_dir)
                
            # Commit back to git repo
            git_commit_changes(commit_message)
            
            # Invalidate in-memory cache
            CACHE_CONN = None
            CACHE_PORTS = None
            return True
        except Exception as e:
            print(f"Error during save to Git filesystem: {e}")
            traceback.print_exc()
            return False

# ----------------- FastAPI Routes -----------------

@app.get("/api/odf/init")
def get_init_data():
    df_conn, df_ports = load_data()
    
    data_centers = sorted(df_conn["Data Center"].dropna().unique().tolist()) if not df_conn.empty else []
    rooms = sorted(df_conn["Room Number"].dropna().unique().tolist()) if not df_conn.empty else []
    files = sorted(df_conn["File Name"].dropna().unique().tolist()) if not df_conn.empty else []
    sheets = sorted(df_conn["Sheet Name"].dropna().unique().tolist()) if not df_conn.empty else []
    
    stats = {
        "data_centers": len(data_centers),
        "rooms": len(rooms),
        "odfs": df_conn["ODF No."].nunique() if not df_conn.empty else 0,
        "ports": len(df_ports)
    }
    
    conn_columns = df_conn.columns.tolist() if not df_conn.empty else []
    port_columns = df_ports.columns.tolist() if not df_ports.empty else []
    
    # Cap Connections and Ports to first 100 sample records to ensure instant initial load
    connections_sample = df_conn.head(100).to_dict(orient="records") if not df_conn.empty else []
    ports_sample = df_ports.head(100).to_dict(orient="records") if not df_ports.empty else []
    
    return json_compatible({
        "data_centers": data_centers,
        "rooms": rooms,
        "files": files,
        "sheets": sheets,
        "stats": stats,
        "conn_columns": conn_columns,
        "port_columns": port_columns,
        "connections": connections_sample,
        "ports": ports_sample
    })

@app.post("/api/odf/filter-options")
def filter_options(filters: dict = Body(...)):
    df_conn, _ = load_data()
    for col, value in filters.items():
        if value and col in df_conn.columns:
            df_conn = df_conn[df_conn[col] == value]
            
    return json_compatible({
        "rooms": sorted(df_conn["Room Number"].dropna().unique().tolist()) if not df_conn.empty else [],
        "files": sorted(df_conn["File Name"].dropna().unique().tolist()) if not df_conn.empty else [],
        "sheets": sorted(df_conn["Sheet Name"].dropna().unique().tolist()) if not df_conn.empty else []
    })

@app.post("/api/odf/filter")
def filter_data(filters: dict = Body(...)):
    try:
        df_conn, df_ports = load_data()
        search_query = filters.pop("search", None)
        
        for col, value in filters.items():
            if value:
                if col in df_conn.columns:
                    df_conn = df_conn[df_conn[col] == value]
                if col in df_ports.columns:
                    df_ports = df_ports[df_ports[col] == value]
                    
        # Highly optimized vectorized pandas/numpy search filter (takes milliseconds instead of 20 seconds)
        if search_query:
            search_query = search_query.lower()
            
            if not df_conn.empty:
                mask_conn = np.column_stack([
                    df_conn[col].astype(str).str.lower().str.contains(search_query, na=False, regex=False) 
                    for col in df_conn.columns if col != "__rowid__"
                ]).any(axis=1)
                df_conn = df_conn[mask_conn]
                
            if not df_ports.empty:
                mask_ports = np.column_stack([
                    df_ports[col].astype(str).str.lower().str.contains(search_query, na=False, regex=False) 
                    for col in df_ports.columns if col != "__rowid__"
                ]).any(axis=1)
                df_ports = df_ports[mask_ports]

        if "ODF No." in df_conn.columns and "ODF No." in df_ports.columns:
            matching_odfs = df_conn["ODF No."].unique()
            df_ports = df_ports[df_ports["ODF No."].isin(matching_odfs)]
            
        total_conn = len(df_conn)
        total_ports = len(df_ports)
        
        # Limit DOM sizes to protect frontend performance
        has_active_filter = any(v for v in filters.values()) or search_query
        
        if not has_active_filter:
            conn_to_send = df_conn.head(100)
            ports_to_send = df_ports.head(100)
        else:
            conn_to_send = df_conn.head(1000)
            ports_to_send = df_ports.head(1000)
            
        return json_compatible({
            "connections": conn_to_send.to_dict(orient="records") if not conn_to_send.empty else [],
            "ports": ports_to_send.to_dict(orient="records") if not ports_to_send.empty else [],
            "total_connections": total_conn,
            "total_ports": total_ports,
            "stats": {
                "data_centers": df_conn["Data Center"].nunique() if not df_conn.empty else 0,
                "rooms": df_conn["Room Number"].nunique() if not df_conn.empty else 0,
                "odfs": df_conn["ODF No."].nunique() if not df_conn.empty else 0,
                "ports": len(df_ports)
            }
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/odf/update")
def update_data(payload: dict = Body(...)):
    try:
        updated_conn = pd.DataFrame(payload.get("connections", []))
        updated_ports = pd.DataFrame(payload.get("ports", []))

        updated_conn = updated_conn.replace('', None)
        updated_ports = updated_ports.replace('', None)

        df_conn_full, df_ports_full = load_data()

        def safe_update(target_df, updates_df):
            for _, row in updates_df.iterrows():
                if "__rowid__" in row and row["__rowid__"] is not None:
                    rowid = int(row["__rowid__"])
                    for col in updates_df.columns:
                        if col != "__rowid__" and col in target_df.columns:
                            target_df.at[rowid, col] = row[col]
            return target_df

        if not updated_conn.empty:
            df_conn_full = safe_update(df_conn_full, updated_conn)
        
        if not updated_ports.empty:
            df_ports_full = safe_update(df_ports_full, updated_ports)

        if not save_data_to_git(df_conn_full, df_ports_full, commit_message="Database modification through editor GUI"):
            raise Exception("Failed to save data")

        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Save failed: {str(e)}")

@app.get("/api/odf/reset")
def reset_data():
    df_conn, df_ports = load_data()
    return json_compatible({
        "connections": df_conn.head(100).to_dict(orient="records") if not df_conn.empty else [],
        "ports": df_ports.head(100).to_dict(orient="records") if not df_ports.empty else [],
        "total_connections": len(df_conn),
        "total_ports": len(df_ports)
    })

@app.get("/api/odf/topology-data")
def topology_data():
    """Generates pre-filtered active patched topology link configurations dynamically under 100ms"""
    try:
        df_conn, df_ports = load_data()
        
        nodes = []
        edges = []
        node_ids = set()
        
        def add_node(nid, label, group, details=None):
            if nid not in node_ids:
                node = {"id": nid, "label": str(label), "group": group}
                if group == "datacenter":
                    node.update({
                        "shape": "database",
                        "color": {"background": "#e74c3c", "border": "#c0392b", "highlight": {"background": "#ff6b6b", "border": "#e74c3c"}},
                        "size": 25,
                        "title": f"Data Center: {label}"
                    })
                elif group == "room":
                    node.update({
                        "shape": "box",
                        "color": {"background": "#f1c40f", "border": "#f39c12", "highlight": {"background": "#fcd02c", "border": "#f1c40f"}},
                        "size": 18,
                        "title": f"Room Hub: {label}"
                    })
                elif group == "file":
                    node.update({
                        "shape": "box",
                        "color": {"background": "#2ecc71", "border": "#27ae60", "highlight": {"background": "#58d68d", "border": "#2ecc71"}},
                        "size": 16,
                        "title": f"ODF Cable Group: {label}"
                    })
                elif group == "odf":
                    node.update({
                        "shape": "dot",
                        "color": {"background": "#3498db", "border": "#2980b9", "highlight": {"background": "#5dade2", "border": "#3498db"}},
                        "size": 16,
                        "title": f"ODF Panel: {label}"
                    })
                elif group == "active_equipment":
                    node.update({
                        "shape": "diamond",
                        "color": {"background": "#9b59b6", "border": "#8e44ad", "highlight": {"background": "#af7ac5", "border": "#9b59b6"}},
                        "size": 15,
                        "title": f"Active Equipment: {label}"
                    })
                if details:
                    node.update(details)
                nodes.append(node)
                node_ids.add(nid)
        
        # 1. Connections
        df_conn_dict = df_conn.to_dict(orient="records") if not df_conn.empty else []
        for idx, row in enumerate(df_conn_dict):
            dc = row.get("Data Center")
            room = row.get("Room Number")
            odf = row.get("ODF No.")
            file_name = row.get("File Name")
            
            dc_id, room_id, file_id, odf_id = None, None, None, None
            if dc:
                dc_id = f"dc_{dc}"
                add_node(dc_id, dc, "datacenter")
            if room and dc:
                room_id = f"room_{dc}_{room}"
                add_node(room_id, room, "room", {"datacenter": dc, "file_name": file_name})
                edges.append({"from": dc_id, "to": room_id, "color": "rgba(255, 255, 255, 0.15)", "width": 1.2, "physics": True})
            if file_name and room and dc:
                clean_file_label = file_name.replace(".xlsx", "") if file_name.endswith(".xlsx") else file_name
                file_id = f"file_{dc}_{room}_{safe_name(file_name)}"
                add_node(file_id, clean_file_label, "file", {"datacenter": dc, "room": room, "file_name": file_name})
                edges.append({"from": room_id, "to": file_id, "color": "rgba(255, 255, 255, 0.2)", "width": 1.2, "physics": True})
            if odf and room and dc:
                odf_id = f"odf_{odf}"
                add_node(odf_id, odf, "odf", {"datacenter": dc, "room": room, "file_name": file_name})
                if file_id:
                    edges.append({"from": file_id, "to": odf_id, "color": "rgba(255, 255, 255, 0.25)", "width": 1.5, "physics": True})
                else:
                    edges.append({"from": room_id, "to": odf_id, "color": "rgba(255, 255, 255, 0.25)", "width": 1.5, "physics": True})
            
            a_end = row.get("A END") or row.get("STATION")
            b_end = row.get("B END")
            cable_name = row.get("Cable Name")
            
            if a_end and b_end:
                node_a, node_b = f"odf_{a_end}", f"odf_{b_end}"
                add_node(node_a, a_end, "odf")
                add_node(node_b, b_end, "odf")
                
                edges.append({
                    "id": f"cable_{idx}",
                    "from": node_a,
                    "to": node_b,
                    "label": str(cable_name) if cable_name else "",
                    "type": "trunk",
                    "color": "#27ae60",
                    "width": 3,
                    "length": 250,
                    "physics": True,
                    "from_label": str(a_end),
                    "to_label": str(b_end),
                    "cable_name": str(cable_name) if cable_name else "Unnamed Cable",
                    "capacity": handle_nan(row.get("CABLE CAPACITY")),
                    "working": handle_nan(row.get("WORKING FIBRE")),
                    "usage": handle_nan(row.get("CABLE USAGE")),
                    "distance": handle_nan(row.get("DISTANCE IN METERS")),
                    "loss_1310": handle_nan(row.get("LOSS IN DB AT 1310")),
                    "loss_1550": handle_nan(row.get("LOSS IN DB AT 1550")),
                    "datacenter": dc,
                    "room": room,
                    "file_name": file_name
                })
        
        # 2. Vectorized filter active patched ports to avoid slow loops
        df_patched = df_ports.dropna(subset=["PATCHED TO"])
        df_patched = df_patched[df_patched["PATCHED TO"].astype(str).str.strip() != ""]
        
        df_patched_dict = df_patched.to_dict(orient="records") if not df_patched.empty else []
        for idx, row in enumerate(df_patched_dict):
            odf_no = row.get("ODF No.")
            patched_to = row.get("PATCHED TO")
            service = row.get("LINK_NAME/SERVICE")
            port_no = row.get("Port No.") or row.get("FIB No")
            
            if odf_no and patched_to:
                node_src = f"odf_{odf_no}"
                port_dc = row.get("Data Center")
                port_room = row.get("Room Number")
                port_file = row.get("File Name")
                
                add_node(node_src, odf_no, "odf", {"datacenter": port_dc, "room": port_room, "file_name": port_file})
                
                is_target_odf = False
                node_dest = f"odf_{patched_to}"
                if node_dest in node_ids:
                    is_target_odf = True
                else:
                    node_dest = f"equip_{patched_to}"
                    add_node(node_dest, patched_to, "active_equipment", {"datacenter": port_dc, "room": port_room, "file_name": port_file})
                
                edges.append({
                    "id": f"patch_{idx}",
                    "from": node_src,
                    "to": node_dest,
                    "label": f"P: {port_no}" if port_no else "Patched",
                    "type": "patch",
                    "color": "#9b59b6",
                    "width": 1.5,
                    "dashes": True,
                    "length": 150,
                    "physics": not is_target_odf,
                    "from_label": f"ODF {odf_no} (Port {port_no or 'N/A'})",
                    "to_label": str(patched_to),
                    "service": str(service) if service else "Active Patched link",
                    "patched_to": str(patched_to),
                    "datacenter": port_dc,
                    "room": port_room,
                    "file_name": port_file
                })
                
        # Send only patched/active ports
        df_ports_active = df_ports[df_ports["PATCHED TO"].notna() & (df_ports["PATCHED TO"].astype(str).str.strip() != "") | 
                                   df_ports["LINK_NAME/SERVICE"].notna() & (df_ports["LINK_NAME/SERVICE"].astype(str).str.strip() != "")]
        df_ports_dict = df_ports_active.to_dict(orient="records") if not df_ports_active.empty else []
        
        return json_compatible({
            "nodes": nodes,
            "edges": edges,
            "ports_data": df_ports_dict
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/odf/export")
def export_data(filters: dict = Body(...)):
    try:
        df_conn, df_ports = load_data()
        
        for col, value in filters.items():
            if value and col != "search":
                if col in df_conn.columns:
                    df_conn = df_conn[df_conn[col] == value]
                if col in df_ports.columns:
                    df_ports = df_ports[df_ports[col] == value]
                    
        df_conn = df_conn.drop(columns=["__rowid__"], errors="ignore")
        df_ports = df_ports.drop(columns=["__rowid__"], errors="ignore")
        
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df_conn.to_excel(writer, index=False, sheet_name="ODF Connections")
            df_ports.to_excel(writer, index=False, sheet_name="ODF Port Details")
        output.seek(0)
        
        now = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        headers = {
            'Content-Disposition': f'attachment; filename="Exported_ODF_Data_{now}.xlsx"'
        }
        return StreamingResponse(
            output,
            headers=headers,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

@app.post("/api/odf/import")
async def import_data(file: UploadFile = File(...)):
    try:
        if not file.filename.endswith(".xlsx"):
            raise HTTPException(status_code=400, detail="Invalid file type. Must be .xlsx")
            
        content = await file.read()
        excel_data = io.BytesIO(content)
        
        uploaded_df_conn = pd.read_excel(excel_data, sheet_name="ODF Connections")
        excel_data.seek(0)
        uploaded_df_ports = pd.read_excel(excel_data, sheet_name="ODF Port Details")
        
        required_conn_cols = ["Data Center", "Room Number", "ODF No."]
        required_port_cols = ["ODF No.", "Port No."]
        
        if not all(col in uploaded_df_conn.columns for col in required_conn_cols):
            raise HTTPException(status_code=400, detail="ODF Connections sheet missing required columns")
        if not all(col in uploaded_df_ports.columns for col in required_port_cols):
            raise HTTPException(status_code=400, detail="ODF Port Details sheet missing required columns")
            
        df_conn_full, df_ports_full = load_data()
        
        df_conn_full = pd.concat([df_conn_full.drop(columns=["__rowid__"], errors='ignore'), uploaded_df_conn], ignore_index=True)
        df_ports_full = pd.concat([df_ports_full.drop(columns=["__rowid__"], errors='ignore'), uploaded_df_ports], ignore_index=True)
        
        if not save_data_to_git(df_conn_full, df_ports_full, commit_message="ODF Excel import uploader merge"):
            raise HTTPException(status_code=500, detail="Failed to save data")
            
        return {"status": "Import successful"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")

@app.post("/api/odf/create-backup")
def manual_backup():
    if create_backup():
        return {"status": "success", "message": "Backup created successfully"}
    raise HTTPException(status_code=500, detail="Backup failed")
