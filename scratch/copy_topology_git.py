import os
import shutil

src = "knowledge/obsidian_topology"
dst = "knowledge/obsidian_topology_git"

ignore_list = ["Devices", "HealthChecks", "Backups", "Inventory", "Topology", "Logs", "Automation", "Sites", "EOL"]

def ignore_func(directory, files):
    ignores = []
    # Check relative path from src
    rel_dir = os.path.relpath(directory, src)
    
    # We only filter at the root of the vault
    if rel_dir == ".":
        for f in files:
            if f in ignore_list:
                ignores.append(f)
            elif f.startswith("Untitled") and f.endswith(".canvas"):
                ignores.append(f)
            elif f.startswith("_COMMUNITY_") and f.endswith(".md"):
                ignores.append(f)
    return ignores

if __name__ == "__main__":
    if os.path.exists(dst):
        print(f"Cleaning existing directory: {dst}")
        shutil.rmtree(dst)
        
    print(f"Copying static vault structure from {src} to {dst}...")
    shutil.copytree(src, dst, ignore=ignore_func)
    print("Vault templates and configurations copied successfully!")
