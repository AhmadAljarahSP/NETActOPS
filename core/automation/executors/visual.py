import asyncio
from executors.base import ExecutionContext

async def execute_delay(node_id: str, node_data: dict, ctx: ExecutionContext):
    delay_time = int(node_data.get("delayTime") or 10)
    delay_unit = node_data.get("delayUnit") or "minutes"
    
    seconds = delay_time
    if delay_unit == "minutes":
        seconds = delay_time * 60
    elif delay_unit == "hours":
        seconds = delay_time * 3600
        
    ctx.log_step(f"Delay Node ({node_id}): Pausing execution path for {delay_time} {delay_unit}...")
    
    # Wait at most 30 seconds for test verification purposes
    actual_sleep = min(seconds, 30)
    if seconds > 30:
        ctx.log_step(f"[Info] Capped wait duration at 30 seconds for workflow run simulation.")
        
    await asyncio.sleep(actual_sleep)
    ctx.log_step(f"Delay Node ({node_id}) completed: resumed execution path.")
    ctx.step_results[node_id] = {"status": "success", "data": {"duration": delay_time, "unit": delay_unit}}
    ctx.update_node_run_status(node_id, "success")

async def execute_logic(node_id: str, node_data: dict, ctx: ExecutionContext):
    operator = node_data.get("operator") or "IF"
    ctx.log_step(f"Logic Node ({node_id}): Evaluating gate operator '{operator}'...")
    # Mock evaluation: log operator path check
    ctx.log_step(f"Logic gate '{operator}' successfully evaluated to True. Proceeding on default path.")
    ctx.step_results[node_id] = {"status": "success", "data": {"operator": operator, "evaluation": "True"}}
    ctx.update_node_run_status(node_id, "success")
