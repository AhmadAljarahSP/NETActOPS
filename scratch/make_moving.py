import os
import math
from PIL import Image, ImageDraw

os.makedirs("assets", exist_ok=True)

def generate_moving_gif(bg_path, output_gif_path, paths, num_frames=24, pulse_color=(0, 255, 255)):
    """
    Loads a static background image, draws animated glowing pulses along
    the specified paths, converts to an optimized adaptive palette,
    and saves the sequence as a lightweight animated GIF.
    """
    if not os.path.exists(bg_path):
        print(f"Background image {bg_path} not found.")
        return
        
    bg = Image.open(bg_path).convert("RGBA")
    width, height = bg.size
    frames = []

    r, g, b = pulse_color

    for f in range(num_frames):
        # Copy the original background image
        frame_img = bg.copy()
        draw = ImageDraw.Draw(frame_img)

        # Draw moving pulses along each path
        for path_pts, phase in paths:
            # Calculate total path length
            total_dist = 0
            segments = []
            for i in range(len(path_pts) - 1):
                p1 = path_pts[i]
                p2 = path_pts[i+1]
                dist = math.hypot(p2[0]-p1[0], p2[1]-p1[1])
                total_dist += dist
                segments.append((p1, p2, dist))

            # Current position along the total distance
            t = ((f / num_frames) + phase) % 1.0
            curr_dist = t * total_dist

            # Find the segment where the pulse is located
            accum_dist = 0
            pulse_x, pulse_y = path_pts[-1]
            for p1, p2, dist in segments:
                if accum_dist <= curr_dist <= accum_dist + dist:
                    seg_t = (curr_dist - accum_dist) / dist
                    pulse_x = p1[0] + seg_t * (p2[0] - p1[0])
                    pulse_y = p1[1] + seg_t * (p2[1] - p1[1])
                    break
                accum_dist += dist

            px, py = int(pulse_x), int(pulse_y)

            # Draw the glowing pulse (outer glow and inner core)
            draw.ellipse([px-10, py-10, px+10, py+10], fill=(r, g, b, 40))
            draw.ellipse([px-6, py-6, px+6, py+6], fill=(r, g, b, 120))
            draw.ellipse([px-3, py-3, px+3, py+3], fill=(255, 255, 255, 255))

        # Convert to P mode with adaptive palette to shrink file size significantly
        frame_p = frame_img.convert("P", palette=Image.Palette.ADAPTIVE, colors=128)
        frames.append(frame_p)

    # Save as animated GIF
    frames[0].save(
        output_gif_path,
        save_all=True,
        append_images=frames[1:],
        optimize=True,
        duration=65,
        loop=0
    )
    print(f"Generated {output_gif_path} successfully.")

if __name__ == "__main__":
    # 1. 5-Stack Ecosystem Moving Paths
    ecosystem_paths = [
        ([(170, 390), (320, 465), (510, 360), (410, 305)], 0.0),
        ([(410, 305), (500, 260), (660, 340), (560, 395)], 0.2),
        ([(560, 395), (660, 445), (820, 365), (720, 305)], 0.4),
        ([(720, 305), (810, 260), (870, 290), (840, 410)], 0.6),
        ([(840, 410), (740, 460), (430, 460), (170, 390)], 0.1),
    ]
    generate_moving_gif(
        bg_path="assets/five_stack_ecosystem.jpg",
        output_gif_path="assets/five_stack_ecosystem.gif",
        paths=ecosystem_paths,
        pulse_color=(0, 255, 255)
    )

    # 2. LangGraph Agent Flow Moving Paths
    langgraph_paths = [
        ([(180, 160), (280, 220), (300, 380), (450, 460), (510, 380), (620, 330), (760, 240), (820, 360), (820, 480)], 0.0),
        ([(180, 160), (280, 220), (300, 380), (450, 460), (510, 380), (620, 330), (760, 240), (820, 360), (820, 480)], 0.5),
    ]
    generate_moving_gif(
        bg_path="assets/langgraph_agent_flow.jpg",
        output_gif_path="assets/langgraph_agent_flow.gif",
        paths=langgraph_paths,
        pulse_color=(16, 185, 129)
    )

    # 3. Data Flow & Lifecycle Moving Paths
    dataflow_paths = [
        ([(150, 200), (300, 200), (450, 200), (450, 350), (600, 200), (750, 200), (750, 350)], 0.0),
        ([(150, 200), (300, 200), (450, 200), (450, 350), (600, 200), (750, 200), (750, 350)], 0.5),
    ]
    generate_moving_gif(
        bg_path="assets/dataflow_lifecycle.jpg",
        output_gif_path="assets/dataflow_lifecycle.gif",
        paths=dataflow_paths,
        pulse_color=(6, 182, 212)
    )

    # 4. GUI Anatomy Exploded Panel Interactions
    gui_paths = [
        ([(200, 150), (200, 300)], 0.0),
        ([(500, 150), (500, 300)], 0.25),
        ([(250, 350), (400, 350)], 0.5),
        ([(500, 400), (500, 480)], 0.75),
        ([(650, 350), (800, 350)], 0.1),
    ]
    generate_moving_gif(
        bg_path="assets/gui_anatomy.jpg",
        output_gif_path="assets/gui_anatomy.gif",
        paths=gui_paths,
        pulse_color=(168, 85, 247)
    )
