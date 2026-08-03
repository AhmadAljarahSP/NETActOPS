import os
import math
from PIL import Image, ImageDraw, ImageFont

# Ensure output directory exists
os.makedirs("assets", exist_ok=True)

# Font Setup (Windows System Fonts)
FONT_REGULAR_PATH = r"C:\Windows\Fonts\segoeui.ttf"
FONT_BOLD_PATH = r"C:\Windows\Fonts\segoeuib.ttf"
FONT_MONO_PATH = r"C:\Windows\Fonts\consola.ttf" # Console/Mono font for code/chat

if os.path.exists(FONT_BOLD_PATH) and os.path.exists(FONT_REGULAR_PATH):
    font_title = ImageFont.truetype(FONT_BOLD_PATH, 16)
    font_body = ImageFont.truetype(FONT_REGULAR_PATH, 11)
    font_bold = ImageFont.truetype(FONT_BOLD_PATH, 11)
    font_header = ImageFont.truetype(FONT_BOLD_PATH, 18)
    font_chat = ImageFont.truetype(FONT_REGULAR_PATH, 12)
else:
    # Fallback to default
    font_title = ImageFont.load_default()
    font_body = ImageFont.load_default()
    font_bold = ImageFont.load_default()
    font_header = ImageFont.load_default()
    font_chat = ImageFont.load_default()

if os.path.exists(FONT_MONO_PATH):
    font_mono = ImageFont.truetype(FONT_MONO_PATH, 11)
else:
    font_mono = font_body

def draw_arrow(draw, start, end, color, width=2, arrow_size=6):
    """Draw an arrow from start to end."""
    x1, y1 = start
    x2, y2 = end
    draw.line([x1, y1, x2, y2], fill=color, width=width)
    
    # Arrow head
    angle = math.atan2(y2 - y1, x2 - x1)
    x3 = x2 - arrow_size * math.cos(angle - math.pi/6)
    y3 = y2 - arrow_size * math.sin(angle - math.pi/6)
    x4 = x2 - arrow_size * math.cos(angle + math.pi/6)
    y4 = y2 - arrow_size * math.sin(angle + math.pi/6)
    draw.polygon([x2, y2, x3, y3, x4, y4], fill=color)

# =========================================================================
# ANIMATION 1: Stacks Architecture (900x650)
# =========================================================================
def generate_architecture_gif():
    width, height = 900, 650
    num_frames = 24
    frames = []

    nodes = {
        "Frontend": ("Frontend Web UI", "Vite & Nginx | :3000", 60, 100, 160, 50, (0, 173, 181, 255)),
        "Backend": ("Backend Core API", "FastAPI & SSH | :8000", 280, 100, 160, 50, (0, 173, 181, 255)),
        "Automation": ("Automation Layer", "Ansible Runner | :8003", 500, 100, 160, 50, (0, 173, 181, 255)),
        "GitSrv": ("Git Manager API", "Uvicorn / Git | :8002", 280, 200, 160, 50, (0, 173, 181, 255)),
        "MCPSrv": ("MCP Server Proxy", "SSE & genie | :5001", 280, 300, 160, 50, (0, 173, 181, 255)),
        
        "CopilotBE": ("AI Copilot API", "LangGraph Graph | :8010", 280, 430, 160, 50, (168, 85, 247, 255)),
        "Ollama": ("Ollama LLM Host", "Llama3.2 | :11434", 60, 430, 160, 50, (168, 85, 247, 255)),
        "Qdrant": ("Qdrant Vector DB", "Embedding search | :6333", 500, 430, 160, 50, (168, 85, 247, 255)),
        
        "TopoBE": ("Topology API", "OSPF / LLDP | :8001", 60, 200, 160, 50, (6, 182, 212, 255)),
        "TopoFE": ("3D Topology Graph", "3D Force Web | :3001", 60, 300, 160, 50, (6, 182, 212, 255)),
        
        "Brain": ("netact-brain", "Obsidian Importer", 720, 200, 140, 50, (249, 115, 22, 255)),
        "ObsidianWeb": ("Obsidian Web", "VNC Canvas | :8085", 720, 100, 140, 50, (249, 115, 22, 255)),
        
        "Prometheus": ("Prometheus DB", "Scraper | :9090", 720, 430, 140, 50, (16, 185, 129, 255)),
        "Grafana": ("Grafana Dashboards", "Viz Metrics | :3002", 720, 540, 140, 50, (16, 185, 129, 255)),
        
        "GitVolume": ("Shared Volume", "git-repo volume", 500, 200, 160, 50, (100, 116, 139, 255)),
        "ObsidianLocal": ("Obsidian Vault", "obsidian_topology/", 720, 300, 140, 50, (249, 115, 22, 255)),
    }

    subgraphs = [
        ("Core Stack", 40, 50, 680, 380, (0, 173, 181, 10)),
        ("AI Stack", 40, 395, 680, 500, (168, 85, 247, 10)),
        ("Knowledge Stack", 700, 50, 880, 380, (249, 115, 22, 10)),
        ("Monitoring Stack", 700, 395, 880, 610, (16, 185, 129, 10)),
    ]

    connections = [
        ("Frontend", "Backend", 0.0),
        ("Frontend", "TopoBE", 0.2),
        ("Frontend", "CopilotBE", 0.4),
        ("Backend", "GitSrv", 0.1),
        ("Backend", "Automation", 0.3),
        ("Brain", "TopoBE", 0.5),
        ("Brain", "ObsidianLocal", 0.0),
        ("ObsidianWeb", "ObsidianLocal", 0.2),
        ("CopilotBE", "ObsidianLocal", 0.6),
        ("CopilotBE", "Qdrant", 0.0),
        ("CopilotBE", "Ollama", 0.3),
        ("CopilotBE", "MCPSrv", 0.5),
        ("Prometheus", "Backend", 0.7),
        ("Prometheus", "CopilotBE", 0.1),
        ("Grafana", "Prometheus", 0.4),
        ("GitVolume", "Backend", 0.8),
        ("GitVolume", "GitSrv", 0.2),
        ("GitVolume", "Automation", 0.4),
        ("GitVolume", "Brain", 0.6),
        ("GitVolume", "CopilotBE", 0.0),
    ]

    for f in range(num_frames):
        img = Image.new("RGBA", (width, height), (9, 13, 22, 255))
        draw = ImageDraw.Draw(img)

        # Draw grid
        for x in range(0, width, 40):
            draw.line([x, 0, x, height], fill=(255, 255, 255, 5))
        for y in range(0, height, 40):
            draw.line([0, y, width, y], fill=(255, 255, 255, 5))

        draw.text((40, 20), "NETACT INTEGRATED PLATFORM STACKS", fill=(255, 255, 255, 220), font=font_header)

        for label, x1, y1, x2, y2, color in subgraphs:
            draw.rectangle([x1, y1, x2, y2], fill=color, outline=(color[0], color[1], color[2], 50), width=1)
            draw.text((x1 + 10, y1 + 8), label.upper(), fill=(color[0], color[1], color[2], 120), font=font_bold)

        for start_id, end_id, offset in connections:
            n_start = nodes[start_id]
            n_end = nodes[end_id]
            s_center = (n_start[2] + n_start[4]//2, n_start[3] + n_start[5]//2)
            e_center = (n_end[2] + n_end[4]//2, n_end[3] + n_end[5]//2)
            draw_arrow(draw, s_center, e_center, (30, 41, 59, 255), width=2, arrow_size=8)

        for start_id, end_id, offset in connections:
            n_start = nodes[start_id]
            n_end = nodes[end_id]
            s_center = (n_start[2] + n_start[4]//2, n_start[3] + n_start[5]//2)
            e_center = (n_end[2] + n_end[4]//2, n_end[3] + n_end[5]//2)
            t = ((f / num_frames) + offset) % 1.0
            px = int((1 - t) * s_center[0] + t * e_center[0])
            py = int((1 - t) * s_center[1] + t * e_center[1])
            draw.ellipse([px-4, py-4, px+4, py+4], fill=(0, 255, 255, 255))
            draw.ellipse([px-8, py-8, px+8, py+8], fill=(0, 255, 255, 80))

        for name, (label, desc, x, y, w, h, border_color) in nodes.items():
            draw.rectangle([x, y, x + w, y + h], fill=(15, 23, 42, 240), outline=border_color, width=1)
            draw.line([x, y, x + w, y], fill=border_color, width=2)
            draw.text((x + 10, y + 8), label, fill=(255, 255, 255, 255), font=font_bold)
            draw.text((x + 10, y + 26), desc, fill=(148, 163, 184, 255), font=font_body)

        frames.append(img)

    frames[0].save("assets/architecture_flow.gif", save_all=True, append_images=frames[1:], optimize=True, duration=60, loop=0)
    print("Generated assets/architecture_flow.gif successfully.")

# =========================================================================
# ANIMATION 2: LangGraph State Machine Flow (900x480)
# =========================================================================
def generate_langgraph_gif():
    width, height = 900, 480
    num_frames = 20
    frames = []

    nodes = {
        "start": ("User Input", "[*] Trigger", 50, 200, 110, 44, (100, 116, 139, 255)),
        "router": ("Intent Router", "Node: Classifier", 200, 200, 120, 44, (56, 189, 248, 255)),
        "retriever": ("Context Retriever", "Node: Vector search", 360, 200, 130, 44, (56, 189, 248, 255)),
        "planner": ("Tool Planner", "Node: Action planning", 530, 200, 120, 44, (56, 189, 248, 255)),
        "classifier": ("Risk Classifier", "Node: Safety guard", 700, 200, 120, 44, (244, 63, 94, 255)),
        
        "routing": ("Risk Route", "Choice Gate", 700, 320, 120, 44, (234, 179, 8, 255)),
        
        "executor": ("Tool Executor", "Node: Telnet/SSH", 500, 320, 130, 44, (16, 185, 129, 255)),
        "gate": ("Approval Gate", "ITSM / User wait", 350, 320, 120, 44, (234, 179, 8, 255)),
        "decline": ("Decline Explanation", "Node: Reject reply", 200, 320, 130, 44, (244, 63, 94, 255)),
        "synthesizer": ("Local Synthesizer", "Node: Response compiler", 350, 90, 150, 44, (168, 85, 247, 255)),
        "preparer": ("Gemini Preparer", "Node: Final translate", 550, 90, 140, 44, (168, 85, 247, 255)),
        "end": ("Response Output", "[*] Complete", 740, 90, 110, 44, (100, 116, 139, 255)),
    }

    connections = [
        ("start", "router", "blue"),
        ("router", "retriever", "blue"),
        ("retriever", "planner", "blue"),
        ("planner", "classifier", "blue"),
        ("classifier", "routing", "red"),
        
        ("routing", "synthesizer", "purple"),
        ("routing", "gate", "yellow"),
        ("routing", "executor", "green"),
        ("routing", "decline", "red"),
        
        ("gate", "executor", "green"),
        ("gate", "decline", "red"),
        
        ("executor", "synthesizer", "purple"),
        ("decline", "synthesizer", "purple"),
        
        ("synthesizer", "preparer", "purple"),
        ("preparer", "end", "gray"),
    ]

    colors = {
        "blue": (56, 189, 248, 255),
        "red": (244, 63, 94, 255),
        "yellow": (234, 179, 8, 255),
        "green": (16, 185, 129, 255),
        "purple": (168, 85, 247, 255),
        "gray": (148, 163, 184, 255)
    }

    for f in range(num_frames):
        img = Image.new("RGBA", (width, height), (9, 13, 22, 255))
        draw = ImageDraw.Draw(img)

        for x in range(0, width, 40):
            draw.line([x, 0, x, height], fill=(255, 255, 255, 5))
        for y in range(0, height, 40):
            draw.line([0, y, width, y], fill=(255, 255, 255, 5))

        draw.text((40, 25), "LANGGRAPH AGENT STATE-TRANSITION ROUTING", fill=(255, 255, 255, 220), font=font_header)

        for start_id, end_id, col_name in connections:
            n_start = nodes[start_id]
            n_end = nodes[end_id]
            s_center = (n_start[2] + n_start[4]//2, n_start[3] + n_start[5]//2)
            e_center = (n_end[2] + n_end[4]//2, n_end[3] + n_end[5]//2)
            draw_arrow(draw, s_center, e_center, (30, 41, 59, 255), width=2, arrow_size=6)

        for start_id, end_id, col_name in connections:
            n_start = nodes[start_id]
            n_end = nodes[end_id]
            s_center = (n_start[2] + n_start[4]//2, n_start[3] + n_start[5]//2)
            e_center = (n_end[2] + n_end[4]//2, n_end[3] + n_end[5]//2)
            t = (f / num_frames) % 1.0
            px = int((1 - t) * s_center[0] + t * e_center[0])
            py = int((1 - t) * s_center[1] + t * e_center[1])
            pulse_color = colors[col_name]
            draw.ellipse([px-4, py-4, px+4, py+4], fill=pulse_color)
            draw.ellipse([px-7, py-7, px+7, py+7], fill=(pulse_color[0], pulse_color[1], pulse_color[2], 80))

        for name, (label, desc, x, y, w, h, border_color) in nodes.items():
            draw.rectangle([x, y, x + w, y + h], fill=(15, 23, 42, 240), outline=border_color, width=1)
            draw.line([x, y, x + w, y], fill=border_color, width=2)
            draw.text((x + 8, y + 8), label, fill=(255, 255, 255, 255), font=font_bold)
            draw.text((x + 8, y + 24), desc, fill=(148, 163, 184, 255), font=font_body)

        frames.append(img)

    frames[0].save("assets/langgraph_flow.gif", save_all=True, append_images=frames[1:], optimize=True, duration=70, loop=0)
    print("Generated assets/langgraph_flow.gif successfully.")

# =========================================================================
# ANIMATION 3: Data Flow & Lifecycle Operations (900x480)
# =========================================================================
def generate_dataflow_gif():
    width, height = 900, 480
    num_frames = 24
    frames = []

    # Horizontal layout for the linear data flow
    nodes = {
        "Request": ("1. User Request", "API Trigger | POST", 40, 200, 130, 50, (0, 173, 181, 255)),
        "Backend": ("2. Core Backend", "Devices API | :8000", 210, 200, 140, 50, (0, 173, 181, 255)),
        "GitSrv": ("3. Git Service", "Version API | :8002", 390, 200, 140, 50, (0, 173, 181, 255)),
        "GitVolume": ("Shared Volume", "git-repo volume", 390, 320, 140, 50, (100, 116, 139, 255)),
        "TopoBE": ("4. Topology BE", "OSPF Adjacency | :8001", 570, 200, 140, 50, (6, 182, 212, 255)),
        "Brain": ("5. netact-brain", "Obsidian Importer", 750, 200, 120, 50, (249, 115, 22, 255)),
        "Vault": ("Obsidian Vault", "obsidian_topology/", 750, 320, 120, 50, (249, 115, 22, 255)),
    }

    connections = [
        ("Request", "Backend", 0.0),
        ("Backend", "GitSrv", 0.2),
        ("GitSrv", "GitVolume", 0.4),
        ("Backend", "TopoBE", 0.3),
        ("TopoBE", "GitVolume", 0.6), # Reads logs
        ("Backend", "Brain", 0.5),
        ("Brain", "Vault", 0.7),      # Writes notes
    ]

    for f in range(num_frames):
        img = Image.new("RGBA", (width, height), (9, 13, 22, 255))
        draw = ImageDraw.Draw(img)

        # Draw grid
        for x in range(0, width, 40):
            draw.line([x, 0, x, height], fill=(255, 255, 255, 5))
        for y in range(0, height, 40):
            draw.line([0, y, width, y], fill=(255, 255, 255, 5))

        draw.text((40, 25), "DATA FLOW & LIFECYCLE OPERATIONS PIPELINE", fill=(255, 255, 255, 220), font=font_header)

        # Draw connection lines
        for start_id, end_id, offset in connections:
            n_start = nodes[start_id]
            n_end = nodes[end_id]
            s_center = (n_start[2] + n_start[4]//2, n_start[3] + n_start[5]//2)
            e_center = (n_end[2] + n_end[4]//2, n_end[3] + n_end[5]//2)
            
            # Special logic: TopoBE reads GitVolume (arrow goes from Volume to TopoBE)
            if start_id == "TopoBE" and end_id == "GitVolume":
                draw_arrow(draw, e_center, s_center, (30, 41, 59, 255), width=2, arrow_size=6)
            else:
                draw_arrow(draw, s_center, e_center, (30, 41, 59, 255), width=2, arrow_size=6)

        # Draw pulses
        for start_id, end_id, offset in connections:
            n_start = nodes[start_id]
            n_end = nodes[end_id]
            s_center = (n_start[2] + n_start[4]//2, n_start[3] + n_start[5]//2)
            e_center = (n_end[2] + n_end[4]//2, n_end[3] + n_end[5]//2)
            
            t = ((f / num_frames) + offset) % 1.0
            
            if start_id == "TopoBE" and end_id == "GitVolume":
                # Pulse goes from GitVolume (end) to TopoBE (start)
                px = int((1 - t) * e_center[0] + t * s_center[0])
                py = int((1 - t) * e_center[1] + t * s_center[1])
            else:
                px = int((1 - t) * s_center[0] + t * e_center[0])
                py = int((1 - t) * s_center[1] + t * e_center[1])
            
            p_color = (6, 182, 212, 255) if "Topo" in start_id or "Brain" in start_id else (0, 173, 181, 255)
            if "Brain" in start_id:
                p_color = (249, 115, 22, 255)
            
            draw.ellipse([px-4, py-4, px+4, py+4], fill=p_color)
            draw.ellipse([px-8, py-8, px+8, py+8], fill=(p_color[0], p_color[1], p_color[2], 80))

        # Draw Nodes
        for name, (label, desc, x, y, w, h, border_color) in nodes.items():
            draw.rectangle([x, y, x + w, y + h], fill=(15, 23, 42, 240), outline=border_color, width=1)
            draw.line([x, y, x + w, y], fill=border_color, width=2)
            draw.text((x + 10, y + 8), label, fill=(255, 255, 255, 255), font=font_bold)
            draw.text((x + 10, y + 26), desc, fill=(148, 163, 184, 255), font=font_body)

        frames.append(img)

    frames[0].save("assets/dataflow_flow.gif", save_all=True, append_images=frames[1:], optimize=True, duration=60, loop=0)
    print("Generated assets/dataflow_flow.gif successfully.")

# =========================================================================
# ANIMATION 4: Anatomy of the User Interface (GUI) (900x520)
# =========================================================================
def generate_gui_gif():
    width, height = 900, 520
    num_frames = 30
    frames = []

    # Mock text streams for chat bubble
    chat_text_full = "R1's GigabitEthernet0/1 interface is shutdown due to a local OSPF metric mismatch. Escalating to Gemini for deep diagnostics..."
    words = chat_text_full.split(" ")

    for f in range(num_frames):
        img = Image.new("RGBA", (width, height), (9, 13, 22, 255))
        draw = ImageDraw.Draw(img)

        # Draw Window Frame
        # Header (Top Bar)
        draw.rectangle([10, 10, 890, 50], fill=(15, 23, 42, 255), outline=(30, 41, 59, 255), width=1)
        draw.text((25, 20), "NETAct Network Operations Platform", fill=(255, 255, 255, 255), font=font_bold)
        
        # User role indicator
        draw.rectangle([800, 18, 875, 42], fill=(0, 173, 181, 40), outline=(0, 173, 181, 255), width=1)
        draw.text((812, 24), "Administrator", fill=(0, 173, 181, 255), font=font_body)

        # -----------------------------------------------------------------
        # Panel 1: Left Navigation Sidebar
        # -----------------------------------------------------------------
        draw.rectangle([10, 55, 170, 510], fill=(15, 23, 42, 255), outline=(30, 41, 59, 255), width=1)
        nav_links = [
            ("Dashboard", False),
            ("Inventory", False),
            ("Topology", True), # Active
            ("AI Assistant", False),
            ("Backups", False),
            ("Settings", False)
        ]
        ny = 75
        for name, active in nav_links:
            if active:
                draw.rectangle([20, ny, 160, ny + 32], fill=(0, 173, 181, 30), outline=(0, 173, 181, 100), width=1)
                draw.text((32, ny + 8), name, fill=(0, 173, 181, 255), font=font_bold)
            else:
                draw.text((32, ny + 8), name, fill=(148, 163, 184, 255), font=font_body)
            ny += 42

        # -----------------------------------------------------------------
        # Panel 2: Center Topology Graph
        # -----------------------------------------------------------------
        draw.rectangle([175, 55, 600, 360], fill=(11, 15, 25, 255), outline=(30, 41, 59, 255), width=1)
        draw.text((190, 70), "Interactive 3D Force Topology", fill=(255, 255, 255, 200), font=font_bold)

        # Physics Simulation: Nodes bounce slightly in dynamic sine waves
        offset_sine = math.sin(f * (2 * math.pi / num_frames))
        offset_cos = math.cos(f * (2 * math.pi / num_frames))

        rtr_a = (300 + int(offset_sine * 8), 160 + int(offset_cos * 4))
        rtr_b = (460 + int(offset_cos * 6), 160 + int(offset_sine * 6))
        swt_c = (300 + int(offset_cos * 4), 260 + int(offset_sine * 8))
        rtr_d = (460 + int(offset_sine * 7), 260 + int(offset_cos * 5))

        # Draw physical link lines
        draw.line([rtr_a[0], rtr_a[1], rtr_b[0], rtr_b[1]], fill=(56, 189, 248, 255), width=2)
        draw.line([rtr_a[0], rtr_a[1], swt_c[0], swt_c[1]], fill=(56, 189, 248, 255), width=2)
        # Glowing link that pulses
        green_alpha = int(120 + 80 * offset_sine)
        draw.line([swt_c[0], swt_c[1], rtr_d[0], rtr_d[1]], fill=(16, 185, 129, green_alpha), width=3)
        draw.line([rtr_b[0], rtr_b[1], rtr_d[0], rtr_d[1]], fill=(56, 189, 248, 255), width=2)

        # Draw Node Circles
        for pos, label, is_rtr in [(rtr_a, "Rtr-A", True), (rtr_b, "Rtr-B", True), (swt_c, "Swt-C", False), (rtr_d, "Rtr-D", True)]:
            bg_color = (15, 23, 42, 255)
            bd_color = (0, 173, 181, 255) if is_rtr else (168, 85, 247, 255)
            
            draw.ellipse([pos[0]-20, pos[1]-20, pos[0]+20, pos[1]+20], fill=bg_color, outline=bd_color, width=2)
            draw.text((pos[0]-14, pos[1]-6), label, fill=(255, 255, 255, 255), font=font_body)

        # Buttons underneath topology
        draw.rectangle([190, 315, 300, 340], fill=(30, 41, 59, 255))
        draw.text((205, 321), "Import Topo", fill=(255, 255, 255, 255), font=font_body)

        draw.rectangle([315, 315, 435, 340], fill=(30, 41, 59, 255))
        draw.text((327, 321), "Upload Map Image", fill=(255, 255, 255, 255), font=font_body)

        # -----------------------------------------------------------------
        # Panel 3: EOL/EOS Lifecycle panel
        # -----------------------------------------------------------------
        draw.rectangle([175, 370, 600, 510], fill=(15, 23, 42, 255), outline=(30, 41, 59, 255), width=1)
        draw.text((190, 382), "EOL/EOS Lifecycle Compliance Monitor", fill=(255, 255, 255, 200), font=font_bold)
        
        # Row 1
        draw.text((190, 415), "Device A (Rtr-A):", fill=(255, 255, 255, 255), font=font_body)
        draw.rectangle([320, 413, 450, 431], fill=(234, 179, 8, 40), outline=(234, 179, 8, 255), width=1)
        draw.text((328, 416), "Warning: EOS Soon", fill=(234, 179, 8, 255), font=font_body)
        
        # Row 2
        draw.text((190, 455), "Device B (Rtr-B):", fill=(255, 255, 255, 255), font=font_body)
        draw.rectangle([320, 453, 450, 471], fill=(16, 185, 129, 40), outline=(16, 185, 129, 255), width=1)
        draw.text((338, 456), "Compliant", fill=(16, 185, 129, 255), font=font_body)

        # -----------------------------------------------------------------
        # Panel 4: Right AI Copilot Panel
        # -----------------------------------------------------------------
        draw.rectangle([605, 55, 890, 510], fill=(15, 23, 42, 255), outline=(30, 41, 59, 255), width=1)
        draw.text((620, 70), "AI Assistant Copilot Chat", fill=(168, 85, 247, 255), font=font_bold)

        # User bubble
        draw.rectangle([620, 100, 875, 150], fill=(30, 41, 59, 150), outline=(56, 189, 248, 100), width=1)
        draw.text((630, 110), "User:", fill=(56, 189, 248, 255), font=font_bold)
        draw.text((630, 128), "why is Rtr-A down?", fill=(255, 255, 255, 255), font=font_chat)

        # Streaming AI response bubble
        # Determine number of words to show based on frame progress
        word_count = int((f / num_frames) * len(words)) + 1
        word_count = min(word_count, len(words))
        current_chat_text = " ".join(words[:word_count])
        
        # Draw AI Bubble
        draw.rectangle([620, 165, 875, 335], fill=(168, 85, 247, 15), outline=(168, 85, 247, 80), width=1)
        draw.text((630, 175), "AI:", fill=(168, 85, 247, 255), font=font_bold)
        
        # Word wrapping helper for chat text
        chat_lines = []
        words_temp = current_chat_text.split(" ")
        line = ""
        for w in words_temp:
            test_line = line + " " + w if line else w
            if len(test_line) * 7 > 220:
                chat_lines.append(line)
                line = w
            else:
                line = test_line
        if line:
            chat_lines.append(line)

        # Draw lines of text
        cy = 195
        for line in chat_lines[:6]:
            draw.text((630, cy), line, fill=(241, 245, 249, 255), font=font_chat)
            cy += 18

        # Cursor at the end (blinking cursor)
        if f % 2 == 0 and word_count < len(words):
            draw.rectangle([630 + (len(chat_lines[-1]) if chat_lines else 0)*6, cy - 18, 630 + (len(chat_lines[-1]) if chat_lines else 0)*6 + 6, cy - 4], fill=(255, 255, 255, 255))

        # Escalate Action Button
        draw.rectangle([620, 350, 875, 385], fill=(168, 85, 247, 200))
        draw.text((670, 360), "Escalate to Gemini Cloud", fill=(255, 255, 255, 255), font=font_bold)

        frames.append(img)

    frames[0].save("assets/gui_mockup.gif", save_all=True, append_images=frames[1:], optimize=True, duration=100, loop=0)
    print("Generated assets/gui_mockup.gif successfully.")

if __name__ == "__main__":
    generate_architecture_gif()
    generate_langgraph_gif()
    generate_dataflow_gif()
    generate_gui_gif()
