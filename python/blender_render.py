"""
blender_render.py — Headless Blender render script for cad-mcp.

Run via: blender --background --python blender_render.py -- <args>

Arguments (after --):
    --model <stl_path>       Path to model STL file
    --output <png_path>      Path to save the render PNG
    --azimuth <degrees>      Camera azimuth (default 45)
    --elevation <degrees>    Camera elevation (default 30)
    --width <px>             Image width (default 800)
    --height <px>            Image height (default 600)
"""

from __future__ import annotations

import argparse
import sys
import os


def parse_args() -> argparse.Namespace:
    # Blender passes its own args before --, user args come after
    if "--" in sys.argv:
        user_args = sys.argv[sys.argv.index("--") + 1 :]
    else:
        user_args = []

    parser = argparse.ArgumentParser(description="Blender headless render for cad-mcp")
    parser.add_argument("--model", required=True, help="Path to input STL file")
    parser.add_argument("--output", required=True, help="Path to output PNG file")
    parser.add_argument("--azimuth", type=float, default=45.0)
    parser.add_argument("--elevation", type=float, default=30.0)
    parser.add_argument("--width", type=int, default=800)
    parser.add_argument("--height", type=int, default=600)
    return parser.parse_args(user_args)


def main() -> None:
    args = parse_args()

    try:
        import bpy  # type: ignore[import-untyped]
    except ImportError:
        print("[blender_render] ERROR: bpy not available. Run this inside Blender.", file=sys.stderr)
        sys.exit(1)

    import math

    # ── Reset scene ──────────────────────────────────────────────────────────
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.filepath = args.output
    scene.render.image_settings.file_format = "PNG"

    # ── Import STL ───────────────────────────────────────────────────────────
    bpy.ops.import_mesh.stl(filepath=args.model)
    obj = bpy.context.selected_objects[0]

    # Centre and normalize
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    obj.location = (0, 0, 0)

    # Simple grey material
    mat = bpy.data.materials.new(name="CAD_Material")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.4, 0.6, 0.9, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.4
        bsdf.inputs["Metallic"].default_value = 0.3
    obj.data.materials.append(mat)

    # ── Camera ───────────────────────────────────────────────────────────────
    bb_size = max(obj.dimensions)
    dist = bb_size * 2.5 if bb_size > 0 else 5.0

    az = math.radians(args.azimuth)
    el = math.radians(args.elevation)
    cam_x = dist * math.cos(el) * math.cos(az)
    cam_y = dist * math.cos(el) * math.sin(az)
    cam_z = dist * math.sin(el)

    bpy.ops.object.camera_add(location=(cam_x, cam_y, cam_z))
    cam = bpy.context.active_object
    scene.camera = cam

    # Point camera at origin
    direction = -cam.location
    rot_quat = direction.to_track_quat("-Z", "Y")
    cam.rotation_euler = rot_quat.to_euler()

    # ── Lighting ─────────────────────────────────────────────────────────────
    bpy.ops.object.light_add(type="SUN", location=(5, 5, 10))
    sun = bpy.context.active_object
    sun.data.energy = 3.0

    bpy.ops.object.light_add(type="AREA", location=(-3, -3, 5))
    fill = bpy.context.active_object
    fill.data.energy = 1.0

    # World background
    world = bpy.data.worlds.new("CAD_World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.1, 0.1, 0.15, 1.0)
        bg.inputs["Strength"].default_value = 0.5

    # ── Render ───────────────────────────────────────────────────────────────
    scene.cycles.samples = 64  # fast preview quality
    bpy.ops.render.render(write_still=True)
    print(f"[blender_render] Rendered to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
