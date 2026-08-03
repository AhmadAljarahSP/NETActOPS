import asyncio
from executors.base import ExecutionContext

async def execute_custom_node(node_id: str, node_data: dict, ctx: ExecutionContext):
    title = node_data.get("title") or "Custom Node"
    desc = node_data.get("description") or "Custom configured element."
    parameters = node_data.get("parameters") or {}
    
    ctx.log_step(f"Custom Node ({node_id}) execution: '{title}' - {desc}")
    
    if parameters:
        param_str = ", ".join([f"{k}={v}" for k, v in parameters.items()])
        ctx.log_step(f"Parameters parsed: {param_str}")
        
    # User-defined actions based on node title and custom parameters:
    if title.lower() == "reboot router":
        ctx.log_step("Action 'Reboot Router' triggered. Simulating device warm reboot...")
        await asyncio.sleep(1.5)
        ctx.log_step("Reboot configuration command sequence completed.")
    elif title.lower() == "save config" or title.lower() == "save settings":
        ctx.log_step("Action 'Save Config' triggered. Executing non-volatile memory sync write...")
        await asyncio.sleep(1.0)
        ctx.log_step("Startup configuration storage write complete.")
        
    ctx.step_results[node_id] = {
        "status": "success", 
        "data": {
            "title": title, 
            "description": desc,
            "parameters": parameters
        }
    }
    ctx.update_node_run_status(node_id, "success")
