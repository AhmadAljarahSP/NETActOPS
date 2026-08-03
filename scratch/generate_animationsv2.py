import os
import math
from datetime import date
from PIL import Image, ImageDraw, ImageFont

# Ensure output directory exists
os.makedirs("assets", exist_ok=True)

# Format current date
CURRENT_DATE = date.today().strftime("%Y-%m-%d")

# Font Setup (Windows System Fonts)
FONT_REGULAR_PATH = r"C:\Windows\Fonts\segoeui.ttf"
FONT_BOLD_PATH = r"C:\Windows\Fonts\segoeuib.ttf"
FONT_MONO_PATH = r"C:\Windows\Fonts\consola.ttf"

if os.path.exists(FONT_BOLD_PATH) and os.path.exists(FONT_REGULAR_PATH):
    font_body = ImageFont.truetype(FONT_REGULAR_PATH, 11)
    font_bold = ImageFont.truetype(FONT_BOLD_PATH, 11)
    font_bold_lg = ImageFont.truetype(FONT_BOLD_PATH, 13)
    font_title = ImageFont.truetype(FONT_BOLD_PATH, 15)
    font_header = ImageFont.truetype(FONT_BOLD_PATH, 24)
    font_large_neon = ImageFont.truetype(FONT_BOLD_PATH, 32)
else:
    font_body = ImageFont.load_default()
    font_bold = ImageFont.load_default()
    font_bold_lg = ImageFont.load_default()
    font_title = ImageFont.load_default()
    font_header = ImageFont.load_default()
    font_large_neon = ImageFont.load_default()

if os.path.exists(FONT_MONO_PATH):
    font_mono = ImageFont.truetype(FONT_MONO_PATH, 11)
else:
    font_mono = font_body

# =========================================================================
# 3D ISOMETRIC ENGINE HELPERS
# =========================================================================
def project_iso(x, y, z, cx=480, cy=240, scale_xy=40, scale_z=40):
    """
    Projects 3D coordinates (x, y, z) into 2D screen coordinates.
    x goes down-right, y goes down-left, z goes straight up.
    """
    screen_x = cx + (x - y) * 0.866 * scale_xy
    screen_y = cy + (x + y) * 0.5 * scale_xy - z * scale_z
    return int(screen_x), int(screen_y)
def draw_iso_arrow(draw, start_3d, end_3d, color, width=2, arrow_size=6, cx=480, cy=240, scale_xy=40, scale_z=40):
    """Draws a 3D-projected arrow."""
    x1, y1 = project_iso(start_3d[0], start_3d[1], start_3d[2], cx, cy, scale_xy, scale_z)
    x2, y2 = project_iso(end_3d[0], end_3d[1], end_3d[2], cx, cy, scale_xy, scale_z)
    
    draw.line([x1, y1, x2, y2], fill=color, width=width)
    
    # Arrow head
    angle = math.atan2(y2 - y1, x2 - x1)
    x3 = x2 - arrow_size * math.cos(angle - math.pi/6)
    y3 = y2 - arrow_size * math.sin(angle - math.pi/6)
    x4 = x2 - arrow_size * math.cos(angle + math.pi/6)
    y4 = y2 - arrow_size * math.sin(angle + math.pi/6)
    draw.polygon([x2, y2, x3, y3, x4, y4], fill=color)

def draw_iso_slab(draw, x, y, z, dx, dy, dz, fill_color, border_color, cx=480, cy=240, scale_xy=40, scale_z=40):
    """
    Draws a 3D isometric slab (glass panel) with semi-transparent faces.
    """
    v000 = project_iso(x, y, z, cx, cy, scale_xy, scale_z)
    v100 = project_iso(x+dx, y, z, cx, cy, scale_xy, scale_z)
    v010 = project_iso(x, y+dy, z, cx, cy, scale_xy, scale_z)
    v110 = project_iso(x+dx, y+dy, z, cx, cy, scale_xy, scale_z)
    
    v001 = project_iso(x, y, z+dz, cx, cy, scale_xy, scale_z)
    v101 = project_iso(x+dx, y, z+dz, cx, cy, scale_xy, scale_z)
    v011 = project_iso(x, y+dy, z+dz, cx, cy, scale_xy, scale_z)
    v111 = project_iso(x+dx, y+dy, z+dz, cx, cy, scale_xy, scale_z)

    r, g, b = fill_color[:3]
    br, bg, bb = border_color[:3]
    
    draw.polygon([v000, v010, v011, v001], fill=(r, g, b, 25), outline=(br, bg, bb, 80))
    draw.polygon([v000, v100, v101, v001], fill=(r, g, b, 35), outline=(br, bg, bb, 100))
    draw.polygon([v001, v101, v111, v011], fill=(r, g, b, 55), outline=(br, bg, bb, 200))

def draw_vertical_panel(draw, x, y, z, dx, dz, thickness, fill_color, border_color, glow_intensity=1.0, cx=480, cy=240, scale_xy=40, scale_z=40):
    """
    Draws a vertical standing panel parallel to the X-Z plane.
    """
    # Base coords (z) and Top coords (z + dz)
    # y is the front face, y + thickness is the back face
    dy = thickness
    
    # 8 vertices
    v000 = project_iso(x, y, z, cx, cy, scale_xy, scale_z)
    v100 = project_iso(x+dx, y, z, cx, cy, scale_xy, scale_z)
    v010 = project_iso(x, y+dy, z, cx, cy, scale_xy, scale_z)
    v110 = project_iso(x+dx, y+dy, z, cx, cy, scale_xy, scale_z)
    
    v001 = project_iso(x, y, z+dz, cx, cy, scale_xy, scale_z)
    v101 = project_iso(x+dx, y, z+dz, cx, cy, scale_xy, scale_z)
    v011 = project_iso(x, y+dy, z+dz, cx, cy, scale_xy, scale_z)
    v111 = project_iso(x+dx, y+dy, z+dz, cx, cy, scale_xy, scale_z)

    # Base panel stand (dark pedestal)
    v_base_l1 = project_iso(x-0.1, y-0.1, z, cx, cy, scale_xy, scale_z)
    v_base_r1 = project_iso(x+dx+0.1, y-0.1, z, cx, cy, scale_xy, scale_z)
    v_base_l2 = project_iso(x-0.1, y+dy+0.1, z, cx, cy, scale_xy, scale_z)
    v_base_r2 = project_iso(x+dx+0.1, y+dy+0.1, z, cx, cy, scale_xy, scale_z)
    
    v_base_l1_u = project_iso(x-0.1, y-0.1, z+0.08, cx, cy, scale_xy, scale_z)
    v_base_r1_u = project_iso(x+dx+0.1, y-0.1, z+0.08, cx, cy, scale_xy, scale_z)
    v_base_l2_u = project_iso(x-0.1, y+dy+0.1, z+0.08, cx, cy, scale_xy, scale_z)
    v_base_r2_u = project_iso(x+dx+0.1, y+dy+0.1, z+0.08, cx, cy, scale_xy, scale_z)

    # Draw stand pedestal (back to front)
    draw.polygon([v_base_l2, v_base_r2, v_base_r2_u, v_base_l2_u], fill=(15, 23, 42, 255), outline=(30, 41, 59, 255))
    draw.polygon([v_base_l1, v_base_l2, v_base_l2_u, v_base_l1_u], fill=(15, 23, 42, 255), outline=(30, 41, 59, 255))
    draw.polygon([v_base_l1, v_base_r1, v_base_r1_u, v_base_l1_u], fill=(20, 30, 50, 255), outline=border_color)
    draw.polygon([v_base_l1_u, v_base_r1_u, v_base_r2_u, v_base_l2_u], fill=(30, 41, 59, 255), outline=border_color)

    # Draw Glass panel faces
    r, g, b = fill_color[:3]
    br, bg, bb = border_color[:3]
    
    # Glow pulses (concentric outlines for pulsing glow)
    glow_alpha = int(120 * glow_intensity)
    inner_alpha = int(45 * glow_intensity)
    
    # Left edge thickness (Y-Z plane)
    draw.polygon([v000, v010, v011, v001], fill=(r, g, b, 20), outline=(br, bg, bb, glow_alpha))
    # Bottom thickness (X-Y plane)
    draw.polygon([v000, v100, v110, v010], fill=(r, g, b, 15), outline=(br, bg, bb, glow_alpha))
    # Right thickness (Y-Z plane at X+dx)
    draw.polygon([v100, v110, v111, v101], fill=(r, g, b, 25), outline=(br, bg, bb, glow_alpha))
    
    # Front Face (X-Z plane at Y)
    draw.polygon([v000, v100, v101, v001], fill=(r, g, b, inner_alpha), outline=(br, bg, bb, 255), width=2)
    # Bevel glow double line for premium glass effect
    v001_b = (v001[0] + 2, v001[1] + 2)
    v101_b = (v101[0] - 2, v101[1] + 2)
    draw.line([v001_b, v101_b], fill=(255, 255, 255, int(150 * glow_intensity)), width=1)

def draw_vector_icon(draw, panel_x, panel_y, panel_z, dx, dz, icon_type, color, cx=480, cy=240, scale_xy=40, scale_z=40):
    """
    Draws custom vector shapes on the front face of the vertical standing panel.
    """
    px = lambda u, w: project_iso(panel_x + u, panel_y, panel_z + w, cx, cy, scale_xy, scale_z)
    
    if icon_type == "core":
        # Draw React (ellipses), FastAPI (lightning), Ansible (circle-A)
        # React Logo left
        c1 = px(0.3, 1.4)
        draw.ellipse([c1[0]-14, c1[1]-14, c1[0]+14, c1[1]+14], outline=(0, 173, 181, 150), width=1)
        # FastAPI Center
        c2 = px(0.8, 1.4)
        draw.polygon([px(0.75, 1.55), px(0.88, 1.55), px(0.82, 1.4), px(0.88, 1.4), px(0.78, 1.25), px(0.81, 1.38), px(0.75, 1.38)], fill=(16, 185, 129, 255))
        # Ansible Right
        c3 = px(1.3, 1.4)
        draw.ellipse([c3[0]-14, c3[1]-14, c3[0]+14, c3[1]+14], fill=(255, 255, 255, 30), outline=(255, 255, 255, 200), width=1)
        draw.text((c3[0]-4, c3[1]-7), "A", fill=(255, 255, 255, 255), font=font_bold)
        
    elif icon_type == "ai":
        # Draw Ollama and Qdrant
        # Ollama Mascot Left
        c1 = px(0.4, 1.4)
        draw.rectangle([c1[0]-12, c1[1]-10, c1[0]+12, c1[1]+10], fill=(255, 255, 255, 20), outline=(255, 255, 255, 180), width=1)
        draw.line([c1[0]-6, c1[1]-14, c1[0]-6, c1[1]-10], fill=(255, 255, 255, 180), width=2)
        draw.line([c1[0]+6, c1[1]-14, c1[0]+6, c1[1]-10], fill=(255, 255, 255, 180), width=2)
        # Qdrant Right
        c2 = px(1.2, 1.4)
        draw_iso_slab(draw, panel_x + 1.0, panel_y, panel_z + 1.2, 0.4, 0.2, 0.3, (244, 63, 94, 100), (244, 63, 94, 255), cx, cy, scale_xy, scale_z)
        
    elif icon_type == "topology":
        # Draw 3D mesh network of nodes and connections
        # Define 4 nodes on the panel surface
        n1 = px(0.3, 1.2)
        n2 = px(0.8, 1.55)
        n3 = px(1.3, 1.2)
        n4 = px(0.8, 1.0)
        
        # Connections
        draw.line([n1, n2], fill=(6, 182, 212, 150), width=1)
        draw.line([n2, n3], fill=(6, 182, 212, 150), width=1)
        draw.line([n3, n4], fill=(6, 182, 212, 150), width=1)
        draw.line([n4, n1], fill=(6, 182, 212, 150), width=1)
        draw.line([n1, n3], fill=(6, 182, 212, 100), width=1)
        draw.line([n2, n4], fill=(6, 182, 212, 100), width=1)
        
        # Nodes
        for n in [n1, n2, n3, n4]:
            draw.ellipse([n[0]-4, n[1]-4, n[0]+4, n[1]+4], fill=(16, 185, 129, 255), outline=(255, 255, 255, 255))
            
    elif icon_type == "knowledge":
        # Draw Purple Gem (crystal structure)
        # Vertices of the crystal projected on panel
        top = px(0.8, 1.55)
        left = px(0.4, 1.25)
        right = px(1.2, 1.35)
        bottom = px(0.8, 1.05)
        center = px(0.8, 1.25)
        
        draw.polygon([top, left, center], fill=(168, 85, 247, 100), outline=(168, 85, 247, 255))
        draw.polygon([top, right, center], fill=(168, 85, 247, 150), outline=(168, 85, 247, 255))
        draw.polygon([bottom, left, center], fill=(168, 85, 247, 80), outline=(168, 85, 247, 255))
        draw.polygon([bottom, right, center], fill=(168, 85, 247, 120), outline=(168, 85, 247, 255))
        
    elif icon_type == "monitoring":
        # Draw tiny mock graphs
        # Background screen grid
        draw.rectangle([px(0.2, 1.15)[0], px(0.2, 1.15)[1], px(1.4, 1.55)[0], px(1.4, 1.55)[1]], fill=(9, 13, 22, 255))
        # Draw green bar charts
        bx = px(0.3, 1.2)[0]
        by = px(0.3, 1.2)[1]
        for i in range(5):
            h = 6 + (i % 2) * 8 + (i % 3) * 4
            draw.rectangle([bx + i * 6, by - h, bx + i * 6 + 4, by], fill=(16, 185, 129, 255))
        # Draw red line chart
        lx = px(0.8, 1.2)[0]
        ly = px(0.8, 1.2)[1]
        pts = [(lx, ly-10), (lx+8, ly-4), (lx+16, ly-15), (lx+24, ly-18), (lx+32, ly-6)]
        draw.line(pts, fill=(244, 63, 94, 255), width=1)

# =========================================================================
# ANIMATION 1: 5-Stack Ecosystem (Shockingly Premium 3D Isometric)
# =========================================================================
def generate_architecture_gif_v2():
    width, height = 1024, 576
    num_frames = 24
    frames = []

    # Slabs arranged in a clean diagonal layout from left to right:
    # {id: (label, x, y, z, dx, dz, thickness, color, icon_type)}
    slabs = {
        "Core": ("CORE STACK", 1.0, 1.0, 0.0, 1.6, 1.8, 0.16, (0, 173, 181, 255), "core"),
        "AI": ("AI STACK", 3.0, 1.5, 0.3, 1.6, 1.8, 0.16, (168, 85, 247, 255), "ai"),
        "Topology": ("TOPOLOGY STACK", 5.0, 2.0, 0.6, 1.6, 1.8, 0.16, (6, 182, 212, 255), "topology"),
        "Knowledge": ("KNOWLEDGE STACK", 7.0, 2.5, 0.9, 1.6, 1.8, 0.16, (249, 115, 22, 255), "knowledge"),
        "Monitoring": ("MONITORING STACK", 9.0, 3.0, 1.2, 1.6, 1.8, 0.16, (236, 72, 153, 255), "monitoring"),
    }

    # Orthogonal Circuit Paths (Start node, list of bend nodes, End node, color, offset_phase)
    circuits = [
        # Core to AI
        ("Core", [(2.6, 1.8, 0.15), (2.6, 2.3, 0.15), (3.8, 2.3, 0.45)], "AI", (0, 173, 181, 255), 0.0),
        # AI to Topology
        ("AI", [(4.6, 2.3, 0.45), (4.6, 2.8, 0.45), (5.8, 2.8, 0.75)], "Topology", (168, 85, 247, 255), 0.2),
        # Topology to Knowledge
        ("Topology", [(6.6, 2.8, 0.75), (6.6, 3.3, 0.75), (7.8, 3.3, 1.05)], "Knowledge", (6, 182, 212, 255), 0.4),
        # Knowledge to Monitoring
        ("Knowledge", [(8.6, 3.3, 1.05), (8.6, 3.8, 1.05), (9.8, 3.8, 1.35)], "Monitoring", (249, 115, 22, 255), 0.6),
        # Monitoring to Core (long return loop)
        ("Monitoring", [(9.8, 4.0, 1.35), (9.8, 4.8, 0.0), (1.8, 4.8, 0.0), (1.8, 1.8, 0.15)], "Core", (236, 72, 153, 255), 0.1),
    ]

    for f in range(num_frames):
        img = Image.new("RGBA", (width, height), (9, 13, 22, 255))
        draw = ImageDraw.Draw(img)

        # Draw dynamic slow pulsing glow factor for panels
        glow_intensity = 0.6 + 0.4 * math.sin(f * (2 * math.pi / num_frames))

        # Draw grid
        for x in range(0, width, 40):
            draw.line([x, 0, x, height], fill=(255, 255, 255, 4))
        for y in range(0, height, 40):
            draw.line([0, y, width, y], fill=(255, 255, 255, 4))

        # Title blocks
        draw.text((40, 30), "NETWORK AUTOMATION", fill=(255, 255, 255, 255), font=font_header)
        draw.text((40, 60), "PLATFORM ARCHITECTURE", fill=(148, 163, 184, 255), font=font_title)
        
        # Subtitle right
        draw.text((820, 30), "5-STACK ECOSYSTEM", fill=(0, 173, 181, 255), font=font_bold_lg)
        
        # Dynamic digital skyline silhouette (bottom left)
        for i in range(15):
            h = 40 + (i % 3) * 15 + (i % 2) * 8
            draw.rectangle([40 + i * 14, height - h, 50 + i * 14, height], fill=(0, 173, 181, 15))
            
        # Large "5-STACK ECOSYSTEM" text bottom left
        draw.text((40, height - 85), "5-STACK", fill=(0, 255, 255, 255), font=font_large_neon)
        draw.text((40, height - 45), "ECOSYSTEM", fill=(0, 255, 255, 255), font=font_large_neon)

        # Date stamp (bottom right)
        draw.text((width - 150, height - 30), f"Generated: {CURRENT_DATE}", fill=(100, 116, 139, 255), font=font_body)

        drawables = []

        # Add circuit paths
        for start_id, bends, end_id, color, phase in circuits:
            n_start = slabs[start_id]
            n_end = slabs[end_id]
            
            # Start/End 3D coords
            p_start = (n_start[1] + n_start[4]/2, n_start[2] + n_start[6]/2, n_start[3])
            p_end = (n_end[1] + n_end[4]/2, n_end[2] + n_end[6]/2, n_end[3])
            
            # Construct complete segment chain
            path_pts = [p_start] + bends + [p_end]
            
            # Draw line segments
            for i in range(len(path_pts) - 1):
                s = path_pts[i]
                e = path_pts[i+1]
                drawables.append({
                    "type": "line",
                    "depth": (s[0]+e[0])/2 + (s[1]+e[1])/2,
                    "start": s,
                    "end": e,
                    "color": (color[0], color[1], color[2], 120)
                })

            # Pulse position calculation along the chain
            t = ((f / num_frames) + phase) % 1.0
            
            # Find which segment the pulse is currently on
            total_segments = len(path_pts) - 1
            seg_idx = int(t * total_segments)
            seg_t = (t * total_segments) % 1.0
            
            s = path_pts[seg_idx]
            e = path_pts[seg_idx + 1]
            
            px = (1 - seg_t) * s[0] + seg_t * e[0]
            py = (1 - seg_t) * s[1] + seg_t * e[1]
            pz = (1 - seg_t) * s[2] + seg_t * e[2]
            
            drawables.append({
                "type": "pulse",
                "depth": px + py,
                "pos": (px, py, pz),
                "color": color
            })

        # Add slabs
        for name, (label, x, y, z, dx, dz, thickness, color, icon_type) in slabs.items():
            drawables.append({
                "type": "slab",
                "depth": x + y + dx/2 + thickness/2,
                "name": name,
                "label": label,
                "x": x, "y": y, "z": z,
                "dx": dx, "dz": dz, "thickness": thickness,
                "color": color,
                "icon_type": icon_type
            })

        # Sort drawables by depth (painter's algorithm)
        drawables.sort(key=lambda d: d["depth"])

        # Render drawables
        for d in drawables:
            if d["type"] == "line":
                draw_iso_arrow(draw, d["start"], d["end"], d["color"], width=2, arrow_size=5, cx=480, cy=220)
            elif d["type"] == "pulse":
                px, py = project_iso(d["pos"][0], d["pos"][1], d["pos"][2], cx=480, cy=220)
                p_color = d["color"]
                draw.ellipse([px-4, py-4, px+4, py+4], fill=p_color)
                draw.ellipse([px-8, py-8, px+8, py+8], fill=(p_color[0], p_color[1], p_color[2], 100))
            elif d["type"] == "slab":
                draw_vertical_panel(draw, d["x"], d["y"], d["z"], d["dx"], d["dz"], d["thickness"], d["color"], d["color"], glow_intensity, cx=480, cy=220)
                # Draw internal custom vector graphics
                draw_vector_icon(draw, d["x"], d["y"], d["z"], d["dx"], d["dz"], d["icon_type"], d["color"], cx=480, cy=220)
                
                # Panel Text details (bottom section of panel)
                tx, ty = project_iso(d["x"] + 0.1, d["y"], d["z"] + 0.75, cx=480, cy=220)
                draw.text((tx, ty), d["label"], fill=(255, 255, 255, 255), font=font_bold_lg)
                draw.text((tx, ty + 15), d["x"] == 1.0 and "Management & Orchestration" or 
                                         d["x"] == 3.0 and "Intelligent Automation" or
                                         d["x"] == 5.0 and "Network Visualization" or
                                         d["x"] == 7.0 and "Documentation & SOPs" or "Telemetry & Observability", fill=(148, 163, 184, 255), font=font_body)
                
                # Bullet points
                bullets = {
                    "Core": ["• React / FastAPI", "• Ansible Engine"],
                    "AI": ["• Llama Models", "• Qdrant DB"],
                    "Topology": ["• Live Adjacency", "• Path Dijkstra"],
                    "Knowledge": ["• Vault SOPs", "• Wiki Notes"],
                    "Monitoring": ["• Prometheus", "• Alert Dashboards"]
                }
                by = ty + 32
                for b in bullets[d["name"]]:
                    draw.text((tx, by), b, fill=(0, 255, 255, 255) if d["name"] == "Core" else (255, 255, 255, 200), font=font_body)
                    by += 12

        frames.append(img)

    frames[0].save("assets/architecture_flow_3d.gif", save_all=True, append_images=frames[1:], optimize=True, duration=60, loop=0)
    print("Generated assets/architecture_flow_3d.gif successfully.")

# =========================================================================
# ANIMATION 2: LangGraph flow (Premium 3D Staircase)
# =========================================================================
def generate_langgraph_gif_v2():
    width, height = 900, 520
    num_frames = 20
    frames = []

    nodes = {
        "router": ("Intent Router", 1.0, 1.0, 0.0, (56, 189, 248, 255)),
        "retriever": ("Retriever", 2.5, 1.0, 0.4, (56, 189, 248, 255)),
        "planner": ("Tool Planner", 4.0, 1.0, 0.8, (56, 189, 248, 255)),
        "classifier": ("Risk Classify", 5.5, 1.0, 1.2, (244, 63, 94, 255)),
        
        "routing": ("Risk routing", 5.5, 2.5, 0.8, (234, 179, 8, 255)),
        
        "gate": ("Approval Gate", 4.0, 2.5, 0.4, (234, 179, 8, 255)),
        "executor": ("Executor", 2.5, 2.5, 0.4, (16, 185, 129, 255)),
        "decline": ("Decline Node", 1.0, 2.5, 0.0, (244, 63, 94, 255)),
        
        "synthesizer": ("Synthesizer", 2.5, 4.0, 0.8, (168, 85, 247, 255)),
        "preparer": ("Gemini Prep", 4.0, 4.0, 1.2, (168, 85, 247, 255)),
        "end": ("Output Reply", 5.5, 4.0, 1.6, (148, 163, 184, 255)),
    }

    connections = [
        ("router", "retriever", "blue"),
        ("retriever", "planner", "blue"),
        ("planner", "classifier", "blue"),
        ("classifier", "routing", "red"),
        
        ("routing", "gate", "yellow"),
        ("routing", "executor", "green"),
        ("routing", "decline", "red"),
        ("routing", "synthesizer", "purple"),
        
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

        # Draw grid
        for x in range(0, width, 40):
            draw.line([x, 0, x, height], fill=(255, 255, 255, 4))
        for y in range(0, height, 40):
            draw.line([0, y, width, y], fill=(255, 255, 255, 4))

        draw.text((40, 25), "LANGGRAPH AGENT 3D STAIRCASE FLOW", fill=(255, 255, 255, 220), font=font_header)
        draw.text((width - 150, height - 30), f"Generated: {CURRENT_DATE}", fill=(100, 116, 139, 255), font=font_body)

        drawables = []

        # Add lines and pulses
        for start_id, end_id, col_name in connections:
            n_start = nodes[start_id]
            n_end = nodes[end_id]
            
            p_start = (n_start[1] + 0.6, n_start[2] + 0.6, n_start[3] + 0.15)
            p_end = (n_end[1] + 0.6, n_end[2] + 0.6, n_end[3] + 0.15)
            
            drawables.append({
                "type": "line",
                "depth": (p_start[0]+p_end[0])/2 + (p_start[1]+p_end[1])/2,
                "start": p_start,
                "end": p_end,
                "color": (51, 65, 85, 255)
            })

            # Pulse
            t = (f / num_frames) % 1.0
            px = (1 - t) * p_start[0] + t * p_end[0]
            py = (1 - t) * p_start[1] + t * p_end[1]
            pz = (1 - t) * p_start[2] + t * p_end[2]
            
            drawables.append({
                "type": "pulse",
                "depth": px + py,
                "pos": (px, py, pz),
                "color": colors[col_name]
            })

        # Add steps
        for name, (label, x, y, z, color) in nodes.items():
            drawables.append({
                "type": "slab",
                "depth": x + y + 0.6,
                "x": x, "y": y, "z": z,
                "dx": 1.2, "dy": 1.2, "dz": 0.15,
                "color": color,
                "label": label
            })

        drawables.sort(key=lambda d: d["depth"])

        for d in drawables:
            if d["type"] == "line":
                draw_iso_arrow(draw, d["start"], d["end"], d["color"], width=2, arrow_size=6)
            elif d["type"] == "pulse":
                px, py = project_iso(d["pos"][0], d["pos"][1], d["pos"][2])
                p_color = d["color"]
                draw.ellipse([px-4, py-4, px+4, py+4], fill=p_color)
                draw.ellipse([px-7, py-7, px+7, py+7], fill=(p_color[0], p_color[1], p_color[2], 80))
            elif d["type"] == "slab":
                draw_iso_slab(draw, d["x"], d["y"], d["z"], d["dx"], d["dy"], d["dz"], d["color"], d["color"])
                tx, ty = project_iso(d["x"] + d["dx"]/2, d["y"] + d["dy"]/2, d["z"] + d["dz"])
                draw.text((tx - 35, ty - 6), d["label"], fill=(255, 255, 255, 255), font=font_bold)

        frames.append(img)

    frames[0].save("assets/langgraph_flow_3d.gif", save_all=True, append_images=frames[1:], optimize=True, duration=70, loop=0)
    print("Generated assets/langgraph_flow_3d.gif successfully.")

# =========================================================================
# ANIMATION 3: Data Flow (3D Isometric layers)
# =========================================================================
def generate_dataflow_gif_v2():
    width, height = 900, 520
    num_frames = 24
    frames = []

    nodes = {
        "Request": ("1. User Request", 1.0, 1.0, 2.0, (0, 173, 181, 255)),
        "Backend": ("2. Core Backend", 3.5, 1.0, 1.2, (0, 173, 181, 255)),
        "GitSrv": ("3. Git Service", 3.5, 3.5, 0.4, (0, 173, 181, 255)),
        "GitVolume": ("git-repo volume", 1.0, 3.5, -0.4, (100, 116, 139, 255)),
        "TopoBE": ("4. Topology API", 6.0, 1.0, 0.4, (6, 182, 212, 255)),
        "Brain": ("5. netact-brain", 6.0, 3.5, 1.2, (249, 115, 22, 255)),
        "Vault": ("Obsidian Vault", 6.0, 6.0, 0.4, (249, 115, 22, 255)),
    }

    connections = [
        ("Request", "Backend", 0.0),
        ("Backend", "GitSrv", 0.2),
        ("GitSrv", "GitVolume", 0.4),
        ("Backend", "TopoBE", 0.3),
        ("TopoBE", "GitVolume", 0.6),
        ("Backend", "Brain", 0.5),
        ("Brain", "Vault", 0.7),
    ]

    for f in range(num_frames):
        img = Image.new("RGBA", (width, height), (9, 13, 22, 255))
        draw = ImageDraw.Draw(img)

        # Draw grid
        for x in range(0, width, 40):
            draw.line([x, 0, x, height], fill=(255, 255, 255, 4))
        for y in range(0, height, 40):
            draw.line([0, y, width, y], fill=(255, 255, 255, 4))

        draw.text((40, 25), "3D DATA FLOW & LIFECYCLE OPERATIONS", fill=(255, 255, 255, 220), font=font_header)
        draw.text((width - 150, height - 30), f"Generated: {CURRENT_DATE}", fill=(100, 116, 139, 255), font=font_body)

        drawables = []

        # Add lines and pulses
        for start_id, end_id, offset in connections:
            n_start = nodes[start_id]
            n_end = nodes[end_id]
            
            p_start = (n_start[1] + 0.6, n_start[2] + 0.6, n_start[3] + 0.15)
            p_end = (n_end[1] + 0.6, n_end[2] + 0.6, n_end[3] + 0.15)
            
            drawables.append({
                "type": "line",
                "depth": (p_start[0]+p_end[0])/2 + (p_start[1]+p_end[1])/2,
                "start": p_start,
                "end": p_end,
                "color": (51, 65, 85, 255)
            })

            # Pulse
            t = ((f / num_frames) + offset) % 1.0
            px = (1 - t) * p_start[0] + t * p_end[0]
            py = (1 - t) * p_start[1] + t * p_end[1]
            pz = (1 - t) * p_start[2] + t * p_end[2]
            
            drawables.append({
                "type": "pulse",
                "depth": px + py,
                "pos": (px, py, pz),
                "color": n_start[4]
            })

        # Add steps
        for name, (label, x, y, z, color) in nodes.items():
            drawables.append({
                "type": "slab",
                "depth": x + y + 0.6,
                "x": x, "y": y, "z": z,
                "dx": 1.2, "dy": 1.2, "dz": 0.15,
                "color": color,
                "label": label
            })

        drawables.sort(key=lambda d: d["depth"])

        for d in drawables:
            if d["type"] == "line":
                draw_iso_arrow(draw, d["start"], d["end"], d["color"], width=2, arrow_size=6)
            elif d["type"] == "pulse":
                px, py = project_iso(d["pos"][0], d["pos"][1], d["pos"][2])
                p_color = d["color"]
                draw.ellipse([px-4, py-4, px+4, py+4], fill=p_color)
                draw.ellipse([px-7, py-7, px+7, py+7], fill=(p_color[0], p_color[1], p_color[2], 80))
            elif d["type"] == "slab":
                draw_iso_slab(draw, d["x"], d["y"], d["z"], d["dx"], d["dy"], d["dz"], d["color"], d["color"])
                tx, ty = project_iso(d["x"] + d["dx"]/2, d["y"] + d["dy"]/2, d["z"] + d["dz"])
                draw.text((tx - 40, ty - 6), d["label"], fill=(255, 255, 255, 255), font=font_bold)

        frames.append(img)

    frames[0].save("assets/dataflow_flow_3d.gif", save_all=True, append_images=frames[1:], optimize=True, duration=60, loop=0)
    print("Generated assets/dataflow_flow_3d.gif successfully.")

# =========================================================================
# ANIMATION 4: GUI Anatomy (Premium Exploded 3D Panels View)
# =========================================================================
def generate_gui_gif_v2():
    width, height = 900, 520
    num_frames = 24
    frames = []

    nodes = {
        "Header": ("TOP BAR (Header)", "NETAct | Administrator", 1.0, 1.0, 2.5, 6.0, 1.0, 0.1, (100, 116, 139, 255)),
        "Sidebar": ("NAVBAR (Left Menu)", "Dashboard, Inventory, Topology", 1.0, 2.5, 0.0, 1.5, 4.5, 0.1, (0, 173, 181, 255)),
        "Topology": ("CENTER GRAPH PANEL", "3D Force Topology View", 3.0, 2.5, 0.8, 3.5, 2.5, 0.1, (6, 182, 212, 255)),
        "EOL": ("EOL COMPLIANCE", "Warning & Compliance states", 3.0, 5.5, -0.4, 3.5, 1.5, 0.1, (16, 185, 129, 255)),
        "Copilot": ("AI ASSISTANT PANEL", "Chat input & Gemini escalation", 7.0, 2.5, 1.4, 1.5, 4.5, 0.1, (168, 85, 247, 255)),
    }

    connections = [
        ("Header", "Sidebar", (0.7, 0.5, 0.0), (0.7, 0.5, 0.1), 0.0),
        ("Header", "Topology", (3.0, 0.5, 0.0), (1.7, 0.5, 0.1), 0.2),
        ("Header", "Copilot", (5.5, 0.5, 0.0), (0.7, 0.5, 0.1), 0.4),
        ("Sidebar", "Topology", (1.5, 1.5, 0.05), (0.0, 1.5, 0.05), 0.1),
        ("Topology", "EOL", (1.7, 2.5, 0.0), (1.7, 0.0, 0.1), 0.3),
        ("Topology", "Copilot", (3.5, 1.5, 0.05), (0.0, 1.5, 0.05), 0.5),
    ]

    for f in range(num_frames):
        img = Image.new("RGBA", (width, height), (9, 13, 22, 255))
        draw = ImageDraw.Draw(img)

        # Draw grid
        for x in range(0, width, 40):
            draw.line([x, 0, x, height], fill=(255, 255, 255, 4))
        for y in range(0, height, 40):
            draw.line([0, y, width, y], fill=(255, 255, 255, 4))

        draw.text((40, 25), "NETACT EXPLODED 3D VIEW GUI ANATOMY", fill=(255, 255, 255, 220), font=font_header)
        draw.text((width - 150, height - 30), f"Generated: {CURRENT_DATE}", fill=(100, 116, 139, 255), font=font_body)

        drawables = []

        # Add lines and pulses
        for start_id, end_id, start_off, end_off, phase in connections:
            n_start = nodes[start_id]
            n_end = nodes[end_id]
            

            # Adjust connection offsets
            p_start = (n_start[2] + start_off[0], n_start[3] + start_off[1], n_start[4] + start_off[2])
            p_end = (n_end[2] + end_off[0], n_end[3] + end_off[1], n_end[4] + end_off[2])
            
            drawables.append({
                "type": "line",
                "depth": (p_start[0]+p_end[0])/2 + (p_start[1]+p_end[1])/2,
                "start": p_start,
                "end": p_end,
                "color": (51, 65, 85, 255)
            })

            # Pulse
            t = ((f / num_frames) + phase) % 1.0
            px = (1 - t) * p_start[0] + t * p_end[0]
            py = (1 - t) * p_start[1] + t * p_end[1]
            pz = (1 - t) * p_start[2] + t * p_end[2]
            
            drawables.append({
                "type": "pulse",
                "depth": px + py,
                "pos": (px, py, pz),
                "color": n_start[8]
            })

        # Add slabs
        for name, (label, desc, x, y, z, dx, dy, dz, color) in nodes.items():
            drawables.append({
                "type": "slab",
                "depth": x + y + dx/2 + dy/2,
                "x": x, "y": y, "z": z,
                "dx": dx, "dy": dy, "dz": dz,
                "color": color,
                "label": label,
                "desc": desc
            })

        drawables.sort(key=lambda d: d["depth"])

        for d in drawables:
            if d["type"] == "line":
                draw_iso_arrow(draw, d["start"], d["end"], d["color"], width=2, arrow_size=6)
            elif d["type"] == "pulse":
                px, py = project_iso(d["pos"][0], d["pos"][1], d["pos"][2])
                p_color = d["color"]
                draw.ellipse([px-4, py-4, px+4, py+4], fill=p_color)
                draw.ellipse([px-7, py-7, px+7, py+7], fill=(p_color[0], p_color[1], p_color[2], 80))
            elif d["type"] == "slab":
                draw_iso_slab(draw, d["x"], d["y"], d["z"], d["dx"], d["dy"], d["dz"], d["color"], d["color"])
                tx, ty = project_iso(d["x"] + d["dx"]/2, d["y"] + d["dy"]/2, d["z"] + d["dz"])
                draw.rectangle([tx - 65, ty - 22, tx + 65, ty + 12], fill=(15, 23, 42, 220), outline=d["color"], width=1)
                draw.text((tx - 55, ty - 18), d["label"], fill=(255, 255, 255, 255), font=font_bold)
                draw.text((tx - 55, ty - 4), d["desc"][:20], fill=(148, 163, 184, 255), font=font_body)

        frames.append(img)

    frames[0].save("assets/gui_mockup_3d.gif", save_all=True, append_images=frames[1:], optimize=True, duration=60, loop=0)
    print("Generated assets/gui_mockup_3d.gif successfully.")

if __name__ == "__main__":
    generate_architecture_gif_v2()
    generate_langgraph_gif_v2()
    generate_dataflow_gif_v2()
    generate_gui_gif_v2()
