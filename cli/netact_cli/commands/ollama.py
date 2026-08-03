import typer
from rich.console import Console
from rich.table import Table

from ..config import SERVICES
from ..http import request_json

console = Console()
_BASE = SERVICES["ollama"].base_url


def status() -> None:
    """List models currently pulled into Ollama — direct call to Ollama's own REST API."""
    data = request_json("GET", f"{_BASE}/api/tags")
    models = (data or {}).get("models", [])
    if not models:
        console.print("[yellow]No models found (or Ollama unreachable).[/yellow]")
        return
    table = Table(title="Ollama models")
    table.add_column("name")
    table.add_column("size")
    table.add_column("modified")
    for m in models:
        size_gb = m.get("size", 0) / (1024 ** 3)
        table.add_row(m.get("name", "?"), f"{size_gb:.1f} GB", str(m.get("modified_at", "?"))[:19])
    console.print(table)
