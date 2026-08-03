import asyncio
import os
import unittest
from unittest.mock import patch, AsyncMock
import agent
import graph_sync
import intent_router

# Mock raw terminal outputs for testing
OSPF_MOCK_OUTPUT = """
Area Id          Interface                  Neighbor id      State
0.0.0.0          GigabitEthernet0/0/0       1.1.1.1          Full
"""

LLDP_MOCK_OUTPUT = """
LOCAL-INTF    Port ID       Remote ID         Device Name
GE0/0/1       GE0/0/2       Huawei-Router-2   Huawei-Router-2
"""

class TestNetActAssistant(unittest.IsolatedAsyncioTestCase):

    def test_ospf_parsing(self):
        """Verify regex parsing of Huawei/Cisco OSPF neighbors brief table."""
        neighbors = graph_sync.parse_ospf(OSPF_MOCK_OUTPUT)
        self.assertEqual(len(neighbors), 1)
        self.assertEqual(neighbors[0]["neighbor_id"], "1.1.1.1")
        self.assertEqual(neighbors[0]["local_interface"], "GigabitEthernet0/0/0")
        self.assertEqual(neighbors[0]["state"], "Full")

    def test_lldp_parsing(self):
        """Verify regex parsing of Huawei/Cisco LLDP neighbors brief table."""
        neighbors = graph_sync.parse_lldp(LLDP_MOCK_OUTPUT)
        self.assertEqual(len(neighbors), 1)
        self.assertEqual(neighbors[0]["local_interface"], "GE0/0/1")
        self.assertEqual(neighbors[0]["neighbor_device"], "Huawei-Router-2")

    @patch("intent_router.classify_intent_with_ollama", new_callable=AsyncMock)
    async def test_agent_intent_router_diagnostic(self, mock_classify):
        """Test intent_router node with diagnostic query."""
        mock_classify.return_value = {"intent": "run_diagnostic", "device": "demo-router-01"}
        
        state = {"messages": [AsyncMock(content="show ip interface brief on demo-router-01")]}
        update = await agent.intent_router_node(state)
        
        self.assertEqual(update["intent"], "run_diagnostic")
        self.assertEqual(update["target_devices"], ["demo-router-01"])

    async def test_risk_classifier_read_only(self):
        """Verify that read-only commands do not trigger write risk tier."""
        state = {
            "planned_tools": [{
                "name": "run_device_diagnostic",
                "args": {"device_name": "router-1", "command": "show version"}
            }]
        }
        update = await agent.risk_classifier_node(state)
        self.assertEqual(update["risk_tier"], "read_only")
        self.assertEqual(update["approval_status"], "not_required")

    @patch("sqlite3.connect")
    async def test_risk_classifier_write(self, mock_connect):
        """Verify that automation flows trigger the write risk tier and pending approval."""
        mock_cursor = mock_connect.return_value.cursor.return_value
        mock_cursor.fetchone.return_value = ("TICKET-123",)
        
        state = {
            "planned_tools": [{
                "name": "run_automation_flow",
                "args": {"device_name": "router-1", "flow_type": "UpgradeOSPF"}
            }]
        }
        update = await agent.risk_classifier_node(state)
        self.assertEqual(update["risk_tier"], "write")
        self.assertEqual(update["approval_status"], "pending")
        self.assertGreater(update["approval_requested_at"], 0.0)

    @patch("intent_router.classify_intent_with_ollama", new_callable=AsyncMock)
    @patch("agent.call_ollama", new_callable=AsyncMock)
    @patch("pipelines.run_hybrid_retrieval", new_callable=AsyncMock)
    async def test_langgraph_workflow_read_only(self, mock_hybrid_retrieval, mock_call_ollama, mock_classify):
        """Verify end-to-end execution of a read-only query in LangGraph."""
        mock_hybrid_retrieval.return_value = ("Mock Neo4j facts: GE1 connected to core-1.", False)
        mock_classify.return_value = {"intent": "general_chat", "device": None}
        mock_call_ollama.side_effect = [
            "Answer based on GE1 connected to core-1." # response synthesizer
        ]
        
        config = {"configurable": {"thread_id": "test_thread_read"}}
        inputs = {"messages": [{"role": "user", "content": "where does GE1 connect?"}]}
        
        # Clean state first
        await agent.app.aupdate_state(config, {"messages": [], "tool_results": [], "planned_tools": []})
        
        # Run graph
        async for event in agent.app.astream(inputs, config, stream_mode="updates"):
            pass
            
        final_state = await agent.app.aget_state(config)
        self.assertEqual(final_state.values["risk_tier"], "read_only")
        self.assertIn("Answer based on GE1", final_state.values["final_response"])

    @patch("app.get_latest_healthcheck")
    async def test_fast_path_query_healthcheck_section(self, mock_get_hc):
        """Verify fast-path routing and dynamic extraction of command sections from healthcheck logs."""
        mock_get_hc.return_value = "\n============================================================\n>>> display ospf peer\n============================================================\nOSPF neighbors brief table:\nNeighbor 1.1.1.1 is Full\n============================================================\n>>> display bgp peer\n============================================================\nBGP neighbors:\nState: Established\n"
        
        generator = await intent_router.route_intent_locally(
            "query_healthcheck_section", 
            "demo-router-01", 
            "demo-router-01",
            None,
            "show ospf neighbors on isp-lon-gw-01",
            {},
            "qwen2.5-coder:7b"
        )
        self.assertIsNotNone(generator)
        
        outputs = []
        async for chunk in generator:
            outputs.append(chunk)
            
        full_output = "".join(outputs)
        self.assertIn("OSPF neighbors brief table", full_output)
        self.assertIn("Neighbor 1.1.1.1 is Full", full_output)

    @patch("app.get_latest_healthcheck")
    async def test_dynamic_interface_status_math_filtering(self, mock_get_hc):
        """Verify dynamic math utilization rate filtering (e.g. more than 80) on interfaces log."""
        mock_get_hc.return_value = (
            "\n============================================================\n"
            ">>> display interface\n"
            "============================================================\n"
            "GigabitEthernet0/0/1 current state : UP\n"
            "Last 300 seconds input utility rate: 0.01%\n"
            "Last 300 seconds output utility rate: 85%\n"
            "\n"
            "GigabitEthernet0/0/2 current state : UP\n"
            "Last 300 seconds input utility rate: 0.05%\n"
            "Last 300 seconds output utility rate: 12%\n"
        )
        
        generator = await intent_router.route_intent_locally(
            "query_interface_status", 
            "demo-router-01", 
            "demo-router-01",
            None,
            "share interfaces at demo-router-01 output utility rate more than 80",
            {},
            "qwen2.5-coder:7b"
        )
        self.assertIsNotNone(generator)
        
        outputs = []
        async for chunk in generator:
            outputs.append(chunk)
            
        full_output = "".join(outputs)
        self.assertIn("GigabitEthernet0/0/1", full_output)
        self.assertNotIn("GigabitEthernet0/0/2", full_output)
        self.assertIn("output utility rate: 85%", full_output)

if __name__ == "__main__":
    unittest.main()
