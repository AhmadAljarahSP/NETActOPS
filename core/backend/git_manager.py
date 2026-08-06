import os
import git
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Any, Optional
from enum import Enum

try:
    from cryptography.fernet import Fernet
except ImportError:
    Fernet = None

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")

class CollectionType(Enum):
    BACKUP = "backups"
    HEALTHCHECK = "healthchecks"

def trigger_notification(event_type: str, title: str, message: str):
    def post_thread():
        try:
            import requests
            url = "http://notification-backend:8012/notify"
            requests.post(url, json={
                "event_type": event_type,
                "title": title,
                "message": message
            }, timeout=3.0)
        except Exception:
            pass

    import threading
    threading.Thread(target=post_thread, daemon=True).start()

class GitConfigManager:
    def __init__(self, repo_path: str = "/git/repo"):
        self.repo_path = Path(repo_path)
        self.backups_path = Path(os.getenv("GIT_BACKUPS_PATH", "/git/repo/backups"))
        self.healthchecks_path = Path(os.getenv("GIT_HEALTHCHECKS_PATH", "/git/repo/healthchecks"))
        self.repo = None
        self._commit_cache = {}
        self._init_repo()
    
    def _init_repo(self):
        """Initialize or load the git repository"""
        if not self.repo_path.exists():
            self.repo_path.mkdir(parents=True, exist_ok=True)
        
        # Create subdirectories
        self.backups_path.mkdir(parents=True, exist_ok=True)
        self.healthchecks_path.mkdir(parents=True, exist_ok=True)
        
        try:
            self.repo = git.Repo(self.repo_path)
        except git.InvalidGitRepositoryError:
            self.repo = git.Repo.init(self.repo_path)
            
            # Create initial commit
            readme = self.repo_path / "README.md"
            readme.write_text("""# Network Configuration Backup System

## Repository Structure
- `/backups/` - Full configuration backups
- `/healthchecks/` - Healthcheck command outputs

## Usage
- Backups: Complete device configurations
- Healthchecks: Diagnostic commands (show version, show interfaces, etc.)
""")
            self.repo.index.add([str(readme)])
            self.repo.index.commit("Initial commit: Network config backup system")
    
    def _get_device_path(self, device_name: str, collection_type: CollectionType) -> Path:
        """Get the directory path for a specific device and collection type"""
        safe_name = "".join(c for c in device_name if c.isalnum() or c in ".-_")
        
        if collection_type == CollectionType.BACKUP:
            base_dir = self.backups_path
        else:
            base_dir = self.healthchecks_path
        
        device_dir = base_dir / safe_name
        device_dir.mkdir(parents=True, exist_ok=True)
        return device_dir
    
    def save_config(self, device_id: int, device_name: str, config_text: str, 
                   status: str = "success", error_msg: str = None, 
                   collection_type: CollectionType = CollectionType.BACKUP,
                   duration: float = None) -> Dict[str, Any]:
        """Save device configuration to git repository"""
        device_dir = self._get_device_path(device_name, collection_type)
        
        # Create config file with timestamp and type prefix
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        type_prefix = "backup" if collection_type == CollectionType.BACKUP else "healthcheck"
        config_file = device_dir / f"{type_prefix}_{timestamp}.txt"
        
        # Calculate diff metrics if backup is successful
        changed = True
        lines_added = 0
        lines_deleted = 0
        
        if collection_type == CollectionType.BACKUP and status == "success":
            try:
                prev_backups = self.get_device_collections(device_name, CollectionType.BACKUP, limit=1)
                if prev_backups:
                    prev_backup = prev_backups[0]
                    prev_full = self.get_full_config(device_name, prev_backup["id"], CollectionType.BACKUP)
                    if prev_full and prev_full.get("config_text"):
                        prev_text = prev_full["config_text"]
                        
                        import difflib
                        old_lines = prev_text.splitlines()
                        new_lines = config_text.splitlines()
                        
                        diff = list(difflib.unified_diff(old_lines, new_lines, lineterm=''))
                        
                        added = 0
                        deleted = 0
                        for line in diff:
                            if line.startswith('+') and not line.startswith('+++'):
                                added += 1
                            elif line.startswith('-') and not line.startswith('---'):
                                deleted += 1
                                
                        lines_added = added
                        lines_deleted = deleted
                        changed = (added > 0 or deleted > 0)
                    else:
                        changed = True
                        lines_added = len(config_text.splitlines())
                        lines_deleted = 0
                else:
                    changed = True
                    lines_added = len(config_text.splitlines())
                    lines_deleted = 0
            except Exception as ex:
                print(f"Error calculating diff metrics: {ex}")
        
        # Save config with metadata
        metadata = {
            "device_id": device_id,
            "device_name": device_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": status,
            "error_msg": error_msg,
            "collection_type": collection_type.value,
            "type_prefix": type_prefix,
            "changed": changed,
            "lines_added": lines_added,
            "lines_deleted": lines_deleted
        }
        if duration is not None:
            metadata["duration"] = duration
        
        config_content = f"""# {'='*60}
# {collection_type.value.upper()} COLLECTION
# {'='*60}
# Device: {device_name}
# Device ID: {device_id}
# Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
# Status: {status}
{'# Error: ' + error_msg if error_msg else ''}
# {'='*60}

{config_text}
"""
        
        if Fernet and ENCRYPTION_KEY:
            try:
                f = Fernet(ENCRYPTION_KEY.encode())
                encrypted_data = f.encrypt(config_content.encode('utf-8'))
                config_file.write_bytes(encrypted_data)
                metadata["encrypted"] = True
            except Exception as e:
                print(f"Encryption failed, saving plaintext: {e}")
                config_file.write_text(config_content, encoding='utf-8')
                metadata["encrypted"] = False
        else:
            config_file.write_text(config_content, encoding='utf-8')
            metadata["encrypted"] = False
        
        # Create metadata file
        meta_file = device_dir / f"{type_prefix}_{timestamp}.meta.json"
        meta_file.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
        
        # Git commit
        try:
            relative_path = config_file.relative_to(self.repo_path)
            self.repo.index.add([str(config_file), str(meta_file)])
            commit_msg = f"{collection_type.value.upper()}: {device_name} [{status}] - {timestamp}"
            self.repo.index.commit(commit_msg)
            
            commit_hash = self.repo.head.commit.hexsha[:8]
            try:
                commit_date = datetime.fromtimestamp(self.repo.head.commit.committed_date).isoformat()
                metadata["commit_hash"] = commit_hash
                metadata["commit_date"] = commit_date
                meta_file.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
            except Exception as ex:
                print(f"Failed to update metadata file with commit details: {ex}")
            
            try:
                if status == "success":
                    if type_prefix == "backup":
                        trigger_notification(
                            "backup_run",
                            f"🟢 Backup Succeeded: {device_name}",
                            f"Backup configuration collected and committed successfully for device **{device_name}**."
                        )
                        if changed:
                            trigger_notification(
                                "config_drift",
                                f"⚠️ Configuration Drift Detected: {device_name}",
                                f"Changes detected on device **{device_name}**!\n"
                                f"Lines Added: `{lines_added}` | Lines Deleted: `{lines_deleted}`"
                            )
                    elif type_prefix == "healthcheck":
                        trigger_notification(
                            "healthcheck_run",
                            f"🟢 Healthcheck Succeeded: {device_name}",
                            f"Healthcheck validation for device **{device_name}** passed successfully."
                        )
                else:
                    event = "backup_failed" if type_prefix == "backup" else "healthcheck_failed"
                    label = "Backup" if type_prefix == "backup" else "Healthcheck"
                    trigger_notification(
                        event,
                        f"🔴 {label} Failed: {device_name}",
                        f"{label} pull failed for device **{device_name}**.\n\nError details: `{error_msg}`"
                    )
            except Exception as ex:
                print(f"Failed to dispatch notify: {ex}")
            
            return {
                "id": timestamp,
                "type": type_prefix,
                "collection_type": collection_type.value,
                "device_id": device_id,
                "device_name": device_name,
                "timestamp": timestamp,
                "status": status,
                "file_path": str(config_file),
                "commit_hash": commit_hash
            }
        except Exception as e:
            print(f"Git commit error: {e}")
            return {
                "id": timestamp,
                "type": type_prefix,
                "device_id": device_id,
                "device_name": device_name,
                "timestamp": timestamp,
                "status": status,
                "error": str(e)
            }
    
    def get_device_collections(self, device_name: str, collection_type: CollectionType, 
                               limit: int = 50) -> List[Dict[str, Any]]:
        """Get collection history for a specific device and type"""
        device_dir = self._get_device_path(device_name, collection_type)
        
        if not device_dir.exists():
            return []
        
        type_prefix = "backup" if collection_type == CollectionType.BACKUP else "healthcheck"
        collections = []
        
        for config_file in sorted(device_dir.glob(f"{type_prefix}_*.txt"), reverse=True):
            if len(collections) >= limit:
                break
            
            # Extract timestamp from filename
            timestamp = config_file.stem.replace(f"{type_prefix}_", "")
            meta_file = device_dir / f"{type_prefix}_{timestamp}.meta.json"
            
            metadata = {}
            if meta_file.exists():
                metadata = json.loads(meta_file.read_text(encoding='utf-8'))
            
            # Read config_text (handling encryption fallback)
            is_encrypted = metadata.get("encrypted", False)
            try:
                if is_encrypted and Fernet and ENCRYPTION_KEY:
                    f = Fernet(ENCRYPTION_KEY.encode())
                    raw_bytes = config_file.read_bytes()
                    config_text = f.decrypt(raw_bytes).decode('utf-8')
                else:
                    config_text = config_file.read_text(encoding='utf-8')
            except Exception as e:
                try:
                    config_text = config_file.read_text(encoding='utf-8')
                except:
                    config_text = "[Error decrypting or reading file]"

            preview = config_text[:500] + "..." if len(config_text) > 500 else config_text
            
            # Get git commit info
            commit_hash = metadata.get("commit_hash")
            commit_date = metadata.get("commit_date")
            
            if not commit_hash or not commit_date:
                commit_info = self._get_file_commit_info(config_file)
                commit_hash = commit_hash or commit_info.get("hash", "")
                commit_date = commit_date or commit_info.get("date", "")
            
            collections.append({
                "id": timestamp,
                "type": type_prefix,
                "collection_type": collection_type.value,
                "device_id": metadata.get("device_id"),
                "device_name": device_name,
                "collected_at": metadata.get("timestamp", timestamp),
                "status": metadata.get("status", "success"),
                "error_msg": metadata.get("error_msg"),
                "preview": preview,
                "file_path": str(config_file),
                "commit_hash": commit_hash,
                "commit_date": commit_date,
                "changed": metadata.get("changed", True),
                "lines_added": metadata.get("lines_added", 0),
                "lines_deleted": metadata.get("lines_deleted", 0),
                "duration": metadata.get("duration")
            })
        
        return collections
    
    def _get_file_commit_info(self, file_path: Path) -> Dict[str, str]:
        """Get commit information for a specific file"""
        str_path = str(file_path)
        if hasattr(self, "_commit_cache") and str_path in self._commit_cache:
            return self._commit_cache[str_path]
            
        # Try to batch populate cache for the parent directory
        try:
            self._populate_commit_cache_for_dir(file_path.parent)
        except Exception as e:
            print(f"Error populating commit cache for {file_path.parent}: {e}")
            
        if hasattr(self, "_commit_cache") and str_path in self._commit_cache:
            return self._commit_cache[str_path]
            
        # Standard fallback if not cached
        try:
            commits = list(self.repo.iter_commits(paths=str_path, max_count=1))
            if commits:
                commit = commits[0]
                info = {
                    "hash": commit.hexsha[:8],
                    "date": datetime.fromtimestamp(commit.committed_date).isoformat(),
                    "message": commit.message
                }
                if not hasattr(self, "_commit_cache"):
                    self._commit_cache = {}
                self._commit_cache[str_path] = info
                return info
        except:
            pass
        return {}

    def _populate_commit_cache_for_dir(self, device_dir: Path):
        """Populate the commit cache for all files in a device directory in a single Git call"""
        if not hasattr(self, "_commit_cache"):
            self._commit_cache = {}
            
        try:
            # We construct a relative path to device_dir from self.repo_path
            relative_dir = device_dir.relative_to(self.repo_path)
            # Run git log via low-level Git command runner
            log_output = self.repo.git.log(
                '--name-only', 
                '--format=commit:%h|%cI|%s', 
                '--', 
                str(relative_dir)
            )
            
            current_commit = None
            for line in log_output.splitlines():
                line = line.strip()
                if not line:
                    continue
                if line.startswith("commit:"):
                    parts = line[7:].split("|", 2)
                    if len(parts) >= 2:
                        current_commit = {
                            "hash": parts[0],
                            "date": parts[1],
                            "message": parts[2] if len(parts) > 2 else ""
                        }
                elif current_commit:
                    # This line is a filename relative to repo root
                    full_file_path = self.repo_path / line
                    self._commit_cache[str(full_file_path)] = current_commit
        except Exception as e:
            print(f"Error populating commit cache for {device_dir}: {e}")
    
    def get_full_config(self, device_name: str, backup_id: str, 
                       collection_type: CollectionType) -> Optional[Dict[str, Any]]:
        """Get full configuration text for a specific collection"""
        device_dir = self._get_device_path(device_name, collection_type)
        type_prefix = "backup" if collection_type == CollectionType.BACKUP else "healthcheck"
        config_file = device_dir / f"{type_prefix}_{backup_id}.txt"
        
        print(f"get_full_config: looking for {config_file}")
        
        if not config_file.exists():
            print(f"get_full_config: file does not exist")
            return None
        
        meta_file = device_dir / f"{type_prefix}_{backup_id}.meta.json"
        
        metadata = {}
        if meta_file.exists():
            metadata = json.loads(meta_file.read_text(encoding='utf-8'))
            
        is_encrypted = metadata.get("encrypted", False)
        try:
            if is_encrypted and Fernet and ENCRYPTION_KEY:
                f = Fernet(ENCRYPTION_KEY.encode())
                raw_bytes = config_file.read_bytes()
                config_text = f.decrypt(raw_bytes).decode('utf-8')
            else:
                config_text = config_file.read_text(encoding='utf-8')
        except Exception as e:
            try:
                config_text = config_file.read_text(encoding='utf-8')
            except:
                config_text = "[Error decrypting or reading full config]"
        
        return {
            "id": backup_id,
            "type": type_prefix,
            "collection_type": collection_type.value,
            "device_id": metadata.get("device_id"),
            "device_name": device_name,
            "config_text": config_text,
            "collected_at": metadata.get("timestamp"),
            "status": metadata.get("status", "success")
        }
    
    def compare_configs(self, device_name: str, backup_id1: str, backup_id2: str,
                       collection_type: CollectionType) -> Dict[str, Any]:
        """Compare two configuration versions and return diff"""
        
        print(f"=== compare_configs called ===")
        print(f"device_name: {device_name}")
        print(f"backup_id1: {backup_id1}")
        print(f"backup_id2: {backup_id2}")
        print(f"collection_type: {collection_type}")
        
        # Try to get configs using the existing method
        config1 = self.get_full_config(device_name, backup_id1, collection_type)
        config2 = self.get_full_config(device_name, backup_id2, collection_type)
        
        print(f"config1 found: {config1 is not None}")
        print(f"config2 found: {config2 is not None}")
        
        if not config1 or not config2:
            # Try alternative: directly construct paths
            safe_name = "".join(c for c in device_name if c.isalnum() or c in ".-_")
            base_dir = self.healthchecks_path if collection_type == CollectionType.HEALTHCHECK else self.backups_path
            type_prefix = "healthcheck" if collection_type == CollectionType.HEALTHCHECK else "backup"
            
            device_dir = base_dir / safe_name
            file1 = device_dir / f"{type_prefix}_{backup_id1}.txt"
            file2 = device_dir / f"{type_prefix}_{backup_id2}.txt"
            
            print(f"Alternative path - device_dir: {device_dir}")
            print(f"Alternative file1: {file1} (exists: {file1.exists()})")
            print(f"Alternative file2: {file2} (exists: {file2.exists()})")
            
            if file1.exists() and file2.exists():
                try:
                    with open(file1, 'r', encoding='utf-8') as f:
                        config_text1 = f.read()
                    with open(file2, 'r', encoding='utf-8') as f:
                        config_text2 = f.read()
                    
                    lines1 = config_text1.splitlines()
                    lines2 = config_text2.splitlines()
                    
                    import difflib
                    diff = list(difflib.unified_diff(
                        lines1, lines2,
                        fromfile=f"{collection_type.value} {backup_id1}",
                        tofile=f"{collection_type.value} {backup_id2}",
                        lineterm=""
                    ))
                    
                    return {
                        "backup1": backup_id1,
                        "backup2": backup_id2,
                        "backup1_date": backup_id1,
                        "backup2_date": backup_id2,
                        "diff": diff,
                        "lines_added": sum(1 for line in diff if line.startswith("+") and not line.startswith("+++")),
                        "lines_removed": sum(1 for line in diff if line.startswith("-") and not line.startswith("---"))
                    }
                except Exception as e:
                    return {"error": f"Error reading files: {str(e)}"}
            
            return {"error": f"One or both backups not found. Config1: {config1 is not None}, Config2: {config2 is not None}"}
        
        # Simple line-based diff
        lines1 = config1["config_text"].splitlines()
        lines2 = config2["config_text"].splitlines()
        
        import difflib
        diff = list(difflib.unified_diff(
            lines1, lines2,
            fromfile=f"{collection_type.value} {backup_id1}",
            tofile=f"{collection_type.value} {backup_id2}",
            lineterm=""
        ))
        
        return {
            "backup1": backup_id1,
            "backup2": backup_id2,
            "backup1_date": config1["collected_at"],
            "backup2_date": config2["collected_at"],
            "diff": diff,
            "lines_added": sum(1 for line in diff if line.startswith("+") and not line.startswith("+++")),
            "lines_removed": sum(1 for line in diff if line.startswith("-") and not line.startswith("---"))
        }
    
    def get_all_devices(self, collection_type: CollectionType) -> List[Dict[str, Any]]:
        """Get list of all devices in the repository for a specific collection type"""
        base_dir = self.backups_path if collection_type == CollectionType.BACKUP else self.healthchecks_path
        if not base_dir.exists():
            return []
        
        type_prefix = "backup" if collection_type == CollectionType.BACKUP else "healthcheck"
        devices = []
        for device_dir in base_dir.iterdir():
            if device_dir.is_dir():
                # Get latest collection
                collections = sorted(device_dir.glob(f"{type_prefix}_*.txt"), reverse=True)
                latest_collection = None
                if collections:
                    latest_collection = collections[0].stem.replace(f"{type_prefix}_", "")
                
                devices.append({
                    "name": device_dir.name,
                    "path": str(device_dir),
                    "latest_collection": latest_collection,
                    "collection_count": len(list(device_dir.glob(f"{type_prefix}_*.txt")))
                })
        
        return devices
    
    def get_device_stats(self, device_name: str, collection_type: CollectionType) -> Dict[str, Any]:
        """Get statistics for a specific device and collection type"""
        collections = self.get_device_collections(device_name, collection_type, limit=1000)
        
        if not collections:
            return {"error": f"No {collection_type.value} found for device"}
        
        success_count = sum(1 for b in collections if b["status"] == "success")
        fail_count = sum(1 for b in collections if b["status"] != "success")
        
        total = len(collections)
        success_rate = (success_count / total * 100) if total > 0 else 0
        
        return {
            "device_name": device_name,
            "collection_type": collection_type.value,
            "total_collections": total,
            "successful": success_count,
            "failed": fail_count,
            "success_rate": round(success_rate, 2),
            "latest": collections[0] if collections else None,
            "oldest": collections[-1] if collections else None
        }
    
    def get_global_activity(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Get the most recent activities across both backups and healthchecks"""
        all_activities = []
        
        # Get from both directories
        for base_dir, collection_type in [(self.backups_path, "backup"), (self.healthchecks_path, "healthcheck")]:
            if not base_dir.exists():
                continue
                
            type_prefix = collection_type
            for device_dir in base_dir.iterdir():
                if not device_dir.is_dir():
                    continue
                    
                device_name = device_dir.name
                recent_meta = sorted(device_dir.glob(f"{type_prefix}_*.meta.json"), reverse=True)[:limit]
                
                for meta_file in recent_meta:
                    try:
                        metadata = json.loads(meta_file.read_text(encoding='utf-8'))
                        timestamp_str = metadata.get("timestamp", "")
                        
                        all_activities.append({
                            "device_name": metadata.get("device_name", device_name),
                            "collection_type": collection_type,
                            "status": metadata.get("status", "unknown"),
                            "timestamp": timestamp_str,
                            "collection_id": meta_file.stem.replace(f"{type_prefix}_", "").replace(".meta", ""),
                            "error_msg": metadata.get("error_msg")
                        })
                    except Exception as e:
                        pass
        
        all_activities.sort(key=lambda x: x["timestamp"], reverse=True)
        return all_activities[:limit]
    
    def get_global_stats(self) -> Dict[str, Any]:
        """Get total counts across both backups and healthchecks"""
        stats = {"backups": {"success": 0, "fail": 0}, "healthchecks": {"success": 0, "fail": 0}}
        
        for base_dir, collection_type in [(self.backups_path, "backup"), (self.healthchecks_path, "healthcheck")]:
            if not base_dir.exists():
                continue
                
            type_prefix = collection_type
            for device_dir in base_dir.iterdir():
                if not device_dir.is_dir():
                    continue
                    
                recent_meta = sorted(device_dir.glob(f"{type_prefix}_*.meta.json"), reverse=True)
                if recent_meta:
                    try:
                        metadata = json.loads(recent_meta[0].read_text(encoding='utf-8'))
                        status = metadata.get("status", "unknown")
                        if collection_type == "backup":
                            if status == "success":
                                stats["backups"]["success"] += 1
                            else:
                                stats["backups"]["fail"] += 1
                        else:
                            if status == "success":
                                stats["healthchecks"]["success"] += 1
                            else:
                                stats["healthchecks"]["fail"] += 1
                    except Exception:
                        if collection_type == "backup":
                            stats["backups"]["fail"] += 1
                        else:
                            stats["healthchecks"]["fail"] += 1
        
        return stats

    def set_gold_standard(self, device_name: str, backup_id: Optional[str]) -> Dict[str, Any]:
        """Saves a baseline backup_id (or clears if None) for a device"""
        device_dir = self._get_device_path(device_name, CollectionType.BACKUP)
        gold_file = device_dir / "gold_standard.json"
        
        try:
            if backup_id is None:
                if gold_file.exists():
                    gold_file.unlink()
                commit_msg = f"GOLD STANDARD: cleared baseline for {device_name}"
            else:
                data = {"backup_id": backup_id, "device_name": device_name, "updated_at": datetime.now().isoformat()}
                gold_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
                commit_msg = f"GOLD STANDARD: set baseline {backup_id} for {device_name}"
            
            # Commit the gold standard file changes to git
            try:
                self.repo.index.add([str(gold_file)])
                self.repo.index.commit(commit_msg)
            except Exception as git_err:
                print(f"Git commit error for gold standard: {git_err}")
                
            return {"status": "success", "backup_id": backup_id}
        except Exception as e:
            return {"status": "error", "error": str(e)}

    def get_gold_standard(self, device_name: str) -> Optional[str]:
        """Reads and returns the baseline backup ID for a device"""
        device_dir = self._get_device_path(device_name, CollectionType.BACKUP)
        gold_file = device_dir / "gold_standard.json"

        if not gold_file.exists():
            return None
        try:
            data = json.loads(gold_file.read_text(encoding="utf-8"))
            return data.get("backup_id")
        except Exception:
            return None

    # -------------------------------------------------------------------
    # Automation-orchestrated run results (e.g. the Ansible layer's
    # sanitized run-command / push-config calls). Deliberately a separate,
    # dedicated subdirectory and method rather than shoehorned into the
    # BACKUP/HEALTHCHECK CollectionType — every existing use of
    # CollectionType elsewhere in this file is a strict binary
    # `if == BACKUP else` branch, so adding a third enum value would
    # silently misclassify into HEALTHCHECK everywhere rather than being
    # properly distinguished. This keeps that already-working, heavily
    # relied-upon logic completely untouched while still giving every
    # automation-run result its own durable, git-tracked history.
    def save_automation_run(self, device_name: str, mode: str, request_detail: str,
                             output: str, status: str = "success", error_msg: str = None) -> Dict[str, Any]:
        """Persists one automation-layer device interaction (a sanitized
        diagnostic command or a config push) to its own git-tracked path,
        separate from backups/healthchecks. mode is "diagnostic" or "config"."""
        safe_name = "".join(c for c in device_name if c.isalnum() or c in ".-_")
        base_dir = Path(os.getenv("GIT_AUTOMATION_RUNS_PATH", "/git/repo/automation_runs"))
        device_dir = base_dir / safe_name
        device_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now(timezone.utc)
        run_id = timestamp.strftime("%Y%m%d_%H%M%S")
        record = {
            "id": run_id,
            "device": device_name,
            "mode": mode,
            "request": request_detail,
            "output": output,
            "status": status,
            "error": error_msg,
            "collected_at": timestamp.isoformat(),
        }
        run_file = device_dir / f"{mode}_{run_id}.json"
        try:
            run_file.write_text(json.dumps(record, indent=2), encoding="utf-8")
            self.repo.index.add([str(run_file)])
            commit_msg = f"Automation {mode} run: {device_name} @ {run_id} [{status}]"
            self.repo.index.commit(commit_msg)
            return {"status": "success", "run_id": run_id, "path": str(run_file)}
        except Exception as e:
            return {"status": "error", "error": str(e)}

    def get_automation_runs(self, device_name: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Lists recent automation-layer run records for a device, newest first."""
        safe_name = "".join(c for c in device_name if c.isalnum() or c in ".-_")
        base_dir = Path(os.getenv("GIT_AUTOMATION_RUNS_PATH", "/git/repo/automation_runs"))
        device_dir = base_dir / safe_name
        if not device_dir.exists():
            return []
        records = []
        for f in sorted(device_dir.glob("*.json"), reverse=True)[:limit]:
            try:
                records.append(json.loads(f.read_text(encoding="utf-8")))
            except Exception:
                continue
        return records