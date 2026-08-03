from rich.console import Console
from rich.table import Table

from ..docker_utils import docker_ps_netact

console = Console()


def ps() -> None:
    """Quick glance at every NETAct_* container — no health probing."""
    containers = docker_ps_netact()
    table = Table(title="NETAct containers")
    table.add_column("name")
    table.add_column("image")
    table.add_column("status")
    table.add_column("ports")

    for c in containers:
        table.add_row(
            c.get("Names", c.get("Name", "?")),
            c.get("Image", "?"),
            c.get("Status", c.get("State", "?")),
            c.get("Ports", ""),
        )
    console.print(table)
