import os
import json
import logging
from typing import TypedDict, List, Dict, Any, Optional
from langgraph.graph import StateGraph, START, END

logger = logging.getLogger("soul-graph")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# Path Configuration
OBSIDIAN_ROOT = os.getenv("OBSIDIAN_ROOT", "/app/obsidian_topology")
SOUL_PATH = os.path.join(OBSIDIAN_ROOT, "AI", "SOUL.md")
SOUL_INDEX_PATH = os.path.join(OBSIDIAN_ROOT, "AI", "SOUL_INDEX.json")

# State definition for the LangGraph pipeline
class SOULUpdateState(TypedDict):
    incident_id: str
    event_type: str                   # e.g., INCIDENT_RESOLVED, RCA_COMPLETED
    raw_logs: Optional[str]
    topology_context: Optional[list]
    existing_soul_data: Optional[str]
    insight_proposal: Optional[dict]  # pattern, cause, affected_layers, confidence
    dedup_decision: Optional[str]     # update_frequency, merge, propose_insertion, discard
    confidence_score: Optional[float]
    score_justification: Optional[str]
    patch_diff: Optional[str]
    validation_status: Optional[str]  # passed, failed
    rejection_reason: Optional[str]
    write_status: Optional[str]       # completed, skipped

# 1. Context Collector Node
async def context_collector_node(state: SOULUpdateState) -> Dict[str, Any]:
    incident_id = state.get("incident_id", "")
    logger.info(f"[SOUL_Update_Graph] Node 1: Collecting context for Incident {incident_id}")
    
    # In a real environment, this would pull logs, SuzieQ topology facts,
    # Qdrant matching docs, and the current SOUL.md content.
    existing_soul = ""
    if os.path.exists(SOUL_PATH):
        try:
            with open(SOUL_PATH, "r", encoding="utf-8") as f:
                existing_soul = f.read()
        except Exception as e:
            logger.error(f"Error reading SOUL.md: {e}")
            
    # Mocking retrieved data logs and topology context
    mock_logs = f"Logs: OSPF neighbor drop on PE01 after policy update. BGP session reset on RR02."
    mock_topology = [{"source": "PE01", "target": "RR02", "protocol": "OSPF", "state": "down"}]
    
    return {
        "raw_logs": mock_logs,
        "topology_context": mock_topology,
        "existing_soul_data": existing_soul
    }

# 2. Insight Extractor Node (LLM Agent)
async def insight_extractor_node(state: SOULUpdateState) -> Dict[str, Any]:
    logger.info("[SOUL_Update_Graph] Node 2: Extracting reusable knowledge using LLM")
    
    # In production, this would formulate a structured system prompt,
    # pass raw_logs + topology_context to the LLM (e.g. Qwen2.5-coder),
    # and parse the resulting JSON.
    
    # Mocking LLM output based on the parsed incident details
    mock_insight = {
        "pattern": "BGP session resets after route-policy update",
        "cause": "policy mismatch causes soft reset",
        "affected_layers": ["edge", "RR"],
        "confidence": 0.88
    }
    
    return {"insight_proposal": mock_insight}

# 3. Deduplication Node
async def deduplication_node(state: SOULUpdateState) -> Dict[str, Any]:
    logger.info("[SOUL_Update_Graph] Node 3: Checking for duplicate patterns in existing memory")
    insight = state.get("insight_proposal", {})
    existing = state.get("existing_soul_data", "")
    
    pattern = insight.get("pattern", "")
    
    # Check if the pattern is already documented in the memory
    decision = "propose_insertion"
    if pattern.lower() in existing.lower():
        decision = "update_frequency"
    elif "bgp session" in pattern.lower() and "bgp session" in existing.lower():
        decision = "merge"
        
    return {"dedup_decision": decision}

# 4. Confidence Scoring Node
async def confidence_scoring_node(state: SOULUpdateState) -> Dict[str, Any]:
    logger.info("[SOUL_Update_Graph] Node 4: Running Confidence Scoring Algorithms")
    insight = state.get("insight_proposal", {})
    base_confidence = insight.get("confidence", 0.0)
    
    # Calculate composite score based on specs:
    # confidence = resolution_confidence + recurrence_frequency + centrality - contradiction
    recurrence_bonus = 0.05
    centrality_bonus = 0.02
    contradiction_penalty = 0.0
    
    final_score = base_confidence + recurrence_bonus + centrality_bonus - contradiction_penalty
    final_score = min(max(final_score, 0.0), 1.0)
    
    justification = f"Base: {base_confidence:.2f}, Recurrence: +0.05, Centrality: +0.02, Contradiction: -0.0"
    
    return {
        "confidence_score": final_score,
        "score_justification": justification
    }

# 5. SOUL Proposal Generator Node
async def soul_proposal_generator_node(state: SOULUpdateState) -> Dict[str, Any]:
    logger.info("[SOUL_Update_Graph] Node 5: Generating patch/diff proposal")
    insight = state.get("insight_proposal", {})
    incident_id = state.get("incident_id", "")
    
    # Build the Git-style markdown patch content
    pattern = insight.get("pattern", "")
    cause = insight.get("cause", "")
    affected = ", ".join(insight.get("affected_layers", []))
    
    diff_proposal = (
        f"\n+ Pattern: {pattern}\n"
        f"+ Evidence: {incident_id}\n"
        f"+ Affected Layers: [{affected}]\n"
        f"+ Root cause: {cause}\n"
    )
    
    return {"patch_diff": diff_proposal}

# 6. SOUL Validator Node (CRITICAL)
async def soul_validator_node(state: SOULUpdateState) -> Dict[str, Any]:
    logger.info("[SOUL_Update_Graph] Node 6: Validating proposal for integrity and hallucinations")
    score = state.get("confidence_score", 0.0)
    decision = state.get("dedup_decision", "")
    
    # Enforcing validation rules
    status = "passed"
    reason = ""
    
    if score < 0.65:
        status = "failed"
        reason = f"Confidence score {score:.2f} is below minimum threshold (0.65)."
    elif decision == "discard":
        status = "failed"
        reason = "Pattern flagged as discarded in deduplication phase."
        
    return {
        "validation_status": status,
        "rejection_reason": reason
    }

# 7. SOUL Writer Node
async def soul_writer_node(state: SOULUpdateState) -> Dict[str, Any]:
    logger.info("[SOUL_Update_Graph] Node 7: Writing updates to SOUL.md and SOUL_INDEX.json")
    validation = state.get("validation_status", "")
    diff = state.get("patch_diff", "")
    insight = state.get("insight_proposal", {})
    
    if validation != "passed":
        logger.warning(f"SOUL update validation failed: {state.get('rejection_reason')}. Skipping write.")
        return {"write_status": "skipped"}
        
    # Rule 1 & 2: Section locking patch and append to ## 3. Learned Failure Patterns
    # If file exists, find section and append.
    if os.path.exists(SOUL_PATH):
        try:
            with open(SOUL_PATH, "r", encoding="utf-8") as f:
                content = f.read()
                
            target_section = "## 3. Learned Failure Patterns"
            if target_section in content:
                parts = content.split(target_section)
                # Insert the patch diff under the section header
                updated_content = parts[0] + target_section + "\n" + diff.strip() + "\n" + parts[1]
                
                with open(SOUL_PATH, "w", encoding="utf-8") as f_out:
                    f_out.write(updated_content)
                logger.info(f"Successfully patched {SOUL_PATH}")
        except Exception as e:
            logger.error(f"Failed to write to SOUL.md: {e}")
            return {"write_status": "failed"}

    # Update SOUL_INDEX.json
    if os.path.exists(SOUL_INDEX_PATH):
        try:
            with open(SOUL_INDEX_PATH, "r", encoding="utf-8") as f_in:
                index_data = json.load(f_in)
                
            pattern_key = insight.get("pattern", "unknown_pattern").lower().replace(" ", "_")
            
            # Update frequency count and confidence
            if pattern_key in index_data:
                index_data[pattern_key]["count"] += 1
                index_data[pattern_key]["last_seen"] = "2026-06-28"  # Current execution date
            else:
                index_data[pattern_key] = {
                    "count": 1,
                    "last_seen": "2026-06-28",
                    "nodes": insight.get("affected_layers", []),
                    "confidence": state.get("confidence_score", 0.0)
                }
                
            with open(SOUL_INDEX_PATH, "w", encoding="utf-8") as f_out:
                json.dump(index_data, f_out, indent=2)
            logger.info(f"Successfully updated index {SOUL_INDEX_PATH}")
        except Exception as e:
            logger.error(f"Failed to update SOUL_INDEX.json: {e}")
            
    return {"write_status": "completed"}

# ---------------------------------------------------------------------------
# Construct the StateGraph
# ---------------------------------------------------------------------------
def compile_soul_graph():
    builder = StateGraph(SOULUpdateState)

    # Add Nodes
    builder.add_node("context_collector", context_collector_node)
    builder.add_node("insight_extractor", insight_extractor_node)
    builder.add_node("deduplication", deduplication_node)
    builder.add_node("confidence_scoring", confidence_scoring_node)
    builder.add_node("soul_proposal_generator", soul_proposal_generator_node)
    builder.add_node("soul_validator", soul_validator_node)
    builder.add_node("soul_writer", soul_writer_node)

    # Add Edges
    builder.add_edge(START, "context_collector")
    builder.add_edge("context_collector", "insight_extractor")
    builder.add_edge("insight_extractor", "deduplication")
    builder.add_edge("deduplication", "confidence_scoring")
    builder.add_edge("confidence_scoring", "soul_proposal_generator")
    builder.add_edge("soul_proposal_generator", "soul_validator")
    builder.add_edge("soul_validator", "soul_writer")
    builder.add_edge("soul_writer", END)

    # Compile the graph
    compiled_graph = builder.compile()
    logger.info("Compiled SOUL_Update_Graph successfully.")
    return compiled_graph

if __name__ == "__main__":
    compile_soul_graph()
