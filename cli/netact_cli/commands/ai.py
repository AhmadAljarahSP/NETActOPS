import uuid

import typer
from rich.console import Console

from ..config import SERVICES
from ..http import request_json, stream_text_lines

app = typer.Typer(help="Talk to the NETAct AI copilot (ai backend :8010).")
console = Console()
_BASE = SERVICES["copilot-backend"].base_url


@app.command("ask")
def ask(
    question: str = typer.Argument(..., help="Question to send"),
    model: str = typer.Option(None, "--model", help="Ollama model to use for synthesis"),
) -> None:
    """Send one question, stream the answer, exit (POST /api/copilot/chat)."""
    # Every call needs its own conversation_id — omitting it defaults the
    # backend to a shared "default_thread" (app.py:1485), so unrelated
    # `ask` invocations bleed LangGraph checkpoint state into each other
    # (confirmed live: an OSPF question inherited a stale healthcheck-device
    # answer from an unrelated earlier call).
    payload = {
        "messages": [{"role": "user", "content": question}],
        "mode": "copilot_only",
        "conversation_id": str(uuid.uuid4()),
    }
    if model:
        payload["model"] = model
    for chunk in stream_text_lines("POST", f"{_BASE}/api/copilot/chat", json=payload):
        typer.echo(chunk, nl=False)
    typer.echo()


@app.command("chat")
def chat(model: str = typer.Option(None, "--model", help="Ollama model to use for synthesis")) -> None:
    """Interactive REPL against the copilot, keeping one conversation_id for the session."""
    conversation_id = str(uuid.uuid4())
    console.print("[dim]netact ai chat — Ctrl+C or 'exit' to quit[/dim]")
    while True:
        try:
            question = typer.prompt(">")
        except (typer.Abort, EOFError):
            break
        if question.strip().lower() in ("exit", "quit"):
            break
        payload = {
            "messages": [{"role": "user", "content": question}],
            "mode": "copilot_only",
            "conversation_id": conversation_id,
        }
        if model:
            payload["model"] = model
        for chunk in stream_text_lines("POST", f"{_BASE}/api/copilot/chat", json=payload):
            typer.echo(chunk, nl=False)
        typer.echo()


@app.command("models")
def models() -> None:
    """List available Ollama models for chat (GET /api/copilot/models)."""
    result = request_json("GET", f"{_BASE}/api/copilot/models")
    for m in (result or {}).get("models", []):
        console.print(f"  {m}")
