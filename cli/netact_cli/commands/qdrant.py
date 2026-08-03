import typer
from rich.console import Console
from rich.table import Table

from ..config import SERVICES
from ..http import request_json

console = Console()
_BASE = SERVICES["qdrant"].base_url


def status() -> None:
    """Qdrant collection status — direct call to Qdrant's own REST API, no wrapper exists in the backend."""
    data = request_json("GET", f"{_BASE}/collections")
    names = [c["name"] for c in (data or {}).get("result", {}).get("collections", [])]
    if not names:
        console.print("[yellow]No collections found.[/yellow]")
        return
    table = Table(title="Qdrant collections")
    table.add_column("name")
    table.add_column("points")
    table.add_column("status")
    for name in names:
        detail = request_json("GET", f"{_BASE}/collections/{name}")
        result = (detail or {}).get("result", {})
        table.add_row(name, str(result.get("points_count", "?")), str(result.get("status", "?")))
    console.print(table)
