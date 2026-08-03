from executors.base import ExecutionContext
from executors.standard import (
    execute_device_select,
    execute_pre_check,
    execute_config_deploy,
    execute_post_check,
    execute_git_commit,
    execute_notification
)
from executors.visual import (
    execute_delay,
    execute_logic
)
from executors.ai import execute_ai_agent
from executors.custom import execute_custom_node

async def execute_node(node: dict, ctx: ExecutionContext):
    node_id = node["id"]
    node_type = node["type"]
    node_data = node.get("data") or {}
    
    if node_type == "startNode":
        ctx.step_results[node_id] = {"status": "success"}
        ctx.update_node_run_status(node_id, "success")
    elif node_type == "deviceSelectNode":
        await execute_device_select(node_id, node_data, ctx)
    elif node_type == "preCheckNode":
        await execute_pre_check(node_id, node_data, ctx)
    elif node_type == "configDeployNode":
        await execute_config_deploy(node_id, node_data, ctx)
    elif node_type == "postCheckNode":
        await execute_post_check(node_id, node_data, ctx)
    elif node_type == "gitCommitNode":
        await execute_git_commit(node_id, node_data, ctx)
    elif node_type == "notificationNode":
        await execute_notification(node_id, node_data, ctx)
    elif node_type == "delayNode":
        await execute_delay(node_id, node_data, ctx)
    elif node_type == "logicNode":
        await execute_logic(node_id, node_data, ctx)
    elif node_type == "aiAgentNode":
        await execute_ai_agent(node_id, node_data, ctx)
    elif node_type == "customNode":
        await execute_custom_node(node_id, node_data, ctx)
    else:
        ctx.log_step(f"Warning: Node type '{node_type}' is not recognized. Marking as success.")
        ctx.step_results[node_id] = {"status": "success", "warning": f"Unrecognized type {node_type}"}
        ctx.update_node_run_status(node_id, "success")
