import asyncio
from mcp import ClientSession
from mcp.client.sse import sse_client

async def main():
    print("Connecting to local MCP server via SSE transport...")
    try:
        async with sse_client("http://127.0.0.1:5001/sse") as (read_stream, write_stream):
            print("SSE stream established. Initializing ClientSession...")
            async with ClientSession(read_stream, write_stream) as session:
                print("Performing protocol initialization handshake...")
                await session.initialize()
                
                # 1. List all available tools
                print("\n=== 1. Listing Registered Tools ===")
                tools_result = await session.list_tools()
                for tool in tools_result.tools:
                    print(f"- Tool Name: {tool.name}")
                    print(f"  Description: {tool.description}")
                    
                # 2. Call list_devices tool
                print("\n=== 2. Calling list_devices Tool ===")
                devices_response = await session.call_tool("list_devices")
                # print response content
                for content in devices_response.content:
                    print(content.text)
                    
                # 3. Call run_device_diagnostic tool on demo-router-02
                print("\n=== 3. Calling run_device_diagnostic on demo-router-02 ===")
                cmd = "show version"
                print(f"Running command: '{cmd}'")
                diag_response = await session.call_tool(
                    "run_device_diagnostic",
                    arguments={"device_name": "demo-router-02", "command": cmd}
                )
                for content in diag_response.content:
                    print("Output result:")
                    print(content.text)
                    
    except Exception as e:
        print(f"\nExecution Failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
