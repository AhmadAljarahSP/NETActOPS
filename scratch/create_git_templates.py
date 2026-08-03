import os

dst_base = "knowledge/obsidian_topology_git"

placeholders = {
    "Devices": "# Device Note Placeholder\n\nThis directory will contain automatically generated device status files (e.g., `R1.md`) compiled by the `netact-brain` importer daemon.",
    "HealthChecks": "# Healthcheck Log Placeholder\n\nThis directory will contain parsed CLI command outputs (e.g., OSPF neighbors, LLDP details) populated dynamically by the discovery scheduler.",
    "Backups": "# Configuration Backup Placeholder\n\nThis directory will contain multi-vendor device configuration backups committed by the Git versioning service.",
    "Topology": "# Topology Adjacency Placeholder\n\nThis directory will contain OSPF and LLDP neighbor mappings computed by the topology parsing engines."
}

if __name__ == "__main__":
    for folder, content in placeholders.items():
        folder_path = os.path.join(dst_base, folder)
        os.makedirs(folder_path, exist_ok=True)
        
        file_path = os.path.join(folder_path, "template.md")
        print(f"Creating template placeholder: {file_path}")
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
            
    print("All folder template placeholders created successfully!")
