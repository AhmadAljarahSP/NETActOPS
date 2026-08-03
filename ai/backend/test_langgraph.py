import asyncio
import httpx
import json

async def test_query(query: str, thread_id: str = "test_verification_thread"):
    print("=" * 70)
    print(f"QUERY: {query}")
    print("=" * 70)
    
    url = "http://127.0.0.1:8002/api/copilot/chat"
    payload = {
        "messages": [
            {"role": "user", "content": query}
        ],
        "conversation_id": thread_id,
        "mode": "copilot_only"
    }
    
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            async with client.stream("POST", url, json=payload) as response:
                if response.status_code != 200:
                    print(f"ERROR: HTTP {response.status_code}")
                    print(await response.aread())
                    return
                
                async for line in response.aiter_text():
                    print(line, end="", flush=True)
                print()
    except Exception as e:
        print(f"FAILED: {e}")

async def main():
    # Verify graph compilation
    import sys
    try:
        import agent
        print(f"✓ LangGraph compilation successful. App type: {type(agent.app)}")
    except Exception as e:
        print(f"❌ LangGraph compilation failed: {e}")
        sys.exit(1)

    # 1. Test List Nodes Local Bypass
    await test_query("how many nodes Integrated with Healtcheck ?")
    
    # 2. Test Active Alarms Local Bypass
    await test_query("give a summary of today failed incidents")
    
    # 3. Test Analyze Logs Local Bypass
    await test_query("what was the last healthcheck collected for demo-switch-01?")
    
    # 4. Test High-risk Write Action + Human Approval Gate Interrupt
    await test_query("run backup for demo-switch-01", thread_id="test_approval_gate_thread")
    
    # 5. Test Current Date/Time Local Bypass
    await test_query("can you share the current Date")
    
    # 6. Test RAG / Document Explanation Query
    await test_query("from Huawei IPTV Solution Technical Proposal can you explain what is VOD")
    
    # 7. Test Juniper JFlow RAG Hijack Prevention Query
    await test_query("share juniper jflow configuration from gemini", thread_id="test_jflow_hijack_thread")

if __name__ == "__main__":
    asyncio.run(main())
