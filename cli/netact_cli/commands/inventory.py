from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from ..config import SERVICES
from ..http import request_json

app = typer.Typer(help="Manage the device inventory (core backend :8000).")
console = Console()
_BASE = SERVICES["core-backend"].base_url


@app.command("sync")
def sync() -> None:
    """Force core backend to reload devices/*.yaml from disk (POST /devices/reload)."""
    result = request_json("POST", f"{_BASE}/devices/reload")
    console.print(result if result is not None else "[green]Reload triggered.[/green]")


@app.command("list")
def list_devices(
    group: str = typer.Option(None, "--group", help="Filter by device group"),
) -> None:
    """List devices (GET /devices)."""
    params = {"group": group} if group else {}
    devices = request_json("GET", f"{_BASE}/devices", params=params)
    if not devices:
        console.print("[yellow]No devices found.[/yellow]")
        return
    table = Table(title="NETAct inventory")
    table.add_column("hostname")
    table.add_column("ip_address")
    table.add_column("vendor")
    table.add_column("device_type")
    table.add_column("group")
    for d in devices:
        table.add_row(
            str(d.get("hostname", "?")),
            str(d.get("ip_address", "?")),
            str(d.get("vendor", "?")),
            str(d.get("device_type", "?")),
            str(d.get("group", "?")),
        )
    console.print(table)


@app.command("import")
def import_devices(
    file: Path = typer.Argument(..., exists=True, help="Excel file to import (.xlsx)"),
) -> None:
    """Bulk-import devices from an Excel file (POST /devices/import-excel)."""
    with open(file, "rb") as f:
        result = request_json(
            "POST",
            f"{_BASE}/devices/import-excel",
            files={"file": (file.name, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            timeout=60.0,
        )
    console.print(result)
