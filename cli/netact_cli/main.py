import typer

from .commands import (
    ai, backup, config_show, docker_cmds, doctor, healthcheck,
    inventory, logs, ollama, ps, qdrant, status, topology, upgrade, version, workflow,
)

app = typer.Typer(
    name="netact",
    help="Unified operator CLI for the NETAct platform — every command wraps an existing API or docker command.",
    no_args_is_help=True,
)

# Leaf commands (no further subcommands)
app.command("version")(version.version)
app.command("status")(status.status)
app.command("ps")(ps.ps)
app.command("logs")(logs.logs)
app.command("doctor")(doctor.doctor)
app.command("upgrade")(upgrade.upgrade)
app.command("healthcheck")(healthcheck.healthcheck)

# `netact config show`
config_app = typer.Typer(help="Inspect resolved configuration.")
config_app.command("show")(config_show.config_show)
app.add_typer(config_app, name="config")

# `netact qdrant status`, `netact ollama status`
qdrant_app = typer.Typer(help="Qdrant vector DB status.")
qdrant_app.command("status")(qdrant.status)
app.add_typer(qdrant_app, name="qdrant")

ollama_app = typer.Typer(help="Ollama LLM runtime status.")
ollama_app.command("status")(ollama.status)
app.add_typer(ollama_app, name="ollama")

# Multi-subcommand groups
app.add_typer(inventory.app, name="inventory")
app.add_typer(topology.app, name="topology")
app.add_typer(topology.graph_app, name="graph")
app.add_typer(workflow.app, name="workflow")
app.add_typer(backup.app, name="backup")
app.add_typer(ai.app, name="ai")
app.add_typer(docker_cmds.app, name="docker")


if __name__ == "__main__":
    app()
