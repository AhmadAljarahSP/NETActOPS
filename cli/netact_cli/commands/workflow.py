import typer
from rich.console import Console
from rich.table import Table

from ..config import SERVICES
from ..http import request_json

app = typer.Typer(help="Manage automation workflows (core/automation :8003).")
console = Console()
_BASE = SERVICES["automation"].base_url


@app.command("list")
def list_flows() -> None:
    """List saved workflow templates (GET /flows)."""
    flows = request_json("GET", f"{_BASE}/flows")
    if not flows:
        console.print("[yellow]No workflows found.[/yellow]")
        return
    table = Table(title="NETAct workflows")
    table.add_column("id")
    table.add_column("name")
    table.add_column("description")
    for f in flows:
        table.add_row(str(f.get("id", "?")), str(f.get("name", "?")), str(f.get("description", "")))
    console.print(table)


@app.command("run")
def run(flow_id: str = typer.Argument(..., help="Saved flow id (see `netact workflow list`)")) -> None:
    """Run a saved workflow (GET /flows/{id} then POST /run-flow)."""
    flow = request_json("GET", f"{_BASE}/flows/{flow_id}")
    result = request_json(
        "POST", f"{_BASE}/run-flow",
        json={"name": flow.get("name", flow_id), "nodes": flow.get("nodes", []), "edges": flow.get("edges", [])},
    )
    console.print(result)
    if isinstance(result, dict) and result.get("task_id"):
        console.print(f"\nTrack with: [bold]netact workflow status {result['task_id']}[/bold]")


@app.command("stop")
def stop(task_id: str = typer.Argument(..., help="task_id from `netact workflow run`")) -> None:
    """Cancel an in-flight workflow execution (POST /executions/{task_id}/cancel)."""
    result = request_json("POST", f"{_BASE}/executions/{task_id}/cancel")
    console.print(result)


@app.command("status")
def status(task_id: str = typer.Argument(..., help="task_id from `netact workflow run`")) -> None:
    """Show execution status/logs for a running or finished workflow (GET /executions/{task_id})."""
    result = request_json("GET", f"{_BASE}/executions/{task_id}")
    console.print(result)
