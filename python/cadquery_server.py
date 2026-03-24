#!/usr/bin/env python3
"""
cadquery_server.py — CAD-MCP Python Geometry Server

Runs as a persistent subprocess and communicates with the TypeScript MCP layer
via stdin/stdout using a newline-delimited JSON-RPC 2.0 protocol.

Request:  {"jsonrpc":"2.0","id":1,"method":"create_model","params":{...}}
Response: {"jsonrpc":"2.0","id":1,"result":{...}}
Error:    {"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"..."}}
"""

from __future__ import annotations

import atexit
import json
import logging
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Logging setup — write to stderr so it does not pollute the JSON-RPC stdout
# ---------------------------------------------------------------------------
log_dir = Path(os.environ.get("CAD_MCP_LOGS_DIR", "./logs"))
log_dir.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[
        logging.FileHandler(log_dir / "cad-mcp.log", encoding="utf-8"),
        logging.StreamHandler(sys.stderr),
    ],
)
atexit.register(lambda: logging.shutdown())  # pyre-ignore[6]
log = logging.getLogger("cadquery_server")

# ---------------------------------------------------------------------------
# Output directory — all files MUST stay inside here
# ---------------------------------------------------------------------------
MODELS_DIR = Path(os.environ.get("CAD_MCP_MODELS_DIR", "./models")).resolve()
EXPORTS_DIR = MODELS_DIR / "exports"
PREVIEWS_DIR = MODELS_DIR / "previews"
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)

TEMPLATES_DIR = Path("./templates").resolve()

# ---------------------------------------------------------------------------
# CadQuery import — graceful fallback message if not installed
# ---------------------------------------------------------------------------
try:
    import cadquery as cq  # type: ignore[import-untyped]

    CADQUERY_AVAILABLE = True
    log.info("CadQuery loaded successfully")
except ImportError:
    CADQUERY_AVAILABLE = False
    log.warning("CadQuery not available — install with: pip install cadquery")

try:
    import trimesh  # type: ignore[import-untyped]

    TRIMESH_AVAILABLE = True
except ImportError:
    TRIMESH_AVAILABLE = False
    log.warning("trimesh not available — install with: pip install trimesh")

# ---------------------------------------------------------------------------
# Security helpers
# ---------------------------------------------------------------------------
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9_\-\.]{1,256}$")


def _safe_output_path(name: str, subdir: Path, suffix: str) -> Path:
    """Build a safe output path, rejecting traversal and bad characters."""
    if suffix and name.lower().endswith(suffix.lower()):
        name = name[: -len(suffix)]  # pyre-ignore[6]
    if not _SAFE_NAME_RE.match(name):
        raise ValueError(
            f"Invalid name '{name}'. Use only letters, digits, underscores, hyphens, dots (max 256 chars)."
        )
    path = (subdir / f"{name}{suffix}").resolve()
    # Ensure the resolved path is still inside the expected directory
    if not str(path).startswith(str(subdir.resolve())):
        raise ValueError(f"Path traversal detected for name '{name}'.")
    return path


def _validate_dimension(value: float, name: str) -> float:
    """Reject non-positive or impossibly large dimensions."""
    if value <= 0:
        raise ValueError(f"Dimension '{name}' must be > 0, got {value}.")
    if value > 100_000:
        raise ValueError(f"Dimension '{name}' exceeds maximum of 100 000 mm, got {value}.")
    return value


# ---------------------------------------------------------------------------
# In-memory model registry
# ---------------------------------------------------------------------------
_models: dict[str, Any] = {}  # name -> cadquery Workplane object


def _get_model(name: str) -> Any:
    """Retrieve a model by name or raise a clear error."""
    if name not in _models:
        available = ", ".join(_models.keys()) if _models else "(none)"
        raise KeyError(f"Model '{name}' not found. Available models: {available}")
    return _models[name]


# ===========================================================================
# Handlers
# ===========================================================================


def handle_create_model(params: dict[str, Any]) -> dict[str, Any]:
    """
    Create a parametric 3D model.

    Params:
        output_name (str): identifier for the model
        base_shape (str): box | cylinder | sphere | cone | torus
        parameters (dict): width, height, depth, radius, etc. (all in mm)
        description (str, optional): natural language hint (logged)
        material (str, optional): metadata
        units (str, optional): mm | cm | inch  (default mm; converted to mm internally)
    """
    if not CADQUERY_AVAILABLE:
        raise RuntimeError("CadQuery is not installed. Run: pip install cadquery")

    name = str(params.get("output_name", "model")).strip()
    if not _SAFE_NAME_RE.match(name):
        raise ValueError(f"Invalid output_name '{name}'.")

    shape = str(params.get("base_shape", "box")).lower()
    p = params.get("parameters", {})
    units = str(params.get("units", "mm")).lower()

    # Unit conversion factor → mm
    unit_factor: float = {"mm": 1.0, "cm": 10.0, "inch": 25.4}.get(units, 1.0)

    def dim(key: str, default: float) -> float:
        raw = float(p.get(key, default))
        return _validate_dimension(raw * unit_factor, key)

    log.info(
        "create_model: name=%s shape=%s units=%s description=%s",
        name,
        shape,
        units,
        params.get("description", ""),
    )

    if shape == "box":
        w, h, d = dim("width", 10), dim("height", 10), dim("depth", 10)
        result = cq.Workplane("XY").box(w, h, d)

    elif shape == "cylinder":
        r = dim("radius", 5)
        h = dim("height", 10)
        result = cq.Workplane("XY").cylinder(h, r)

    elif shape == "sphere":
        r = dim("radius", 5)
        result = cq.Workplane("XY").sphere(r)

    elif shape == "cone":
        r1 = dim("radius_bottom", 5)
        r2 = float(p.get("radius_top", 0)) * unit_factor  # may be 0 for a pure cone
        h = dim("height", 10)
        result = cq.Workplane("XY").add(
            cq.Solid.makeCone(r1, max(0.0, r2), h)
        )

    elif shape == "torus":
        r_major = dim("radius_major", 10)
        r_minor = dim("radius_minor", 3)
        result = cq.Workplane("XY").add(
            cq.Solid.makeTorus(r_major, r_minor)
        )

    else:
        raise ValueError(
            f"Unknown base_shape '{shape}'. Supported: box, cylinder, sphere, cone, torus."
        )

    _models[name] = result
    log.info("create_model: stored '%s' in memory.", name)

    return {
        "name": name,
        "shape": shape,
        "units": "mm",
        "message": f"Model '{name}' created successfully.",
    }


def handle_export_model(params: dict[str, Any]) -> dict[str, Any]:
    """
    Export an in-memory model to a standard format file.

    Params:
        name (str): model identifier
        format (str): STL | STEP | OBJ | GLTF | DXF
        output_name (str, optional): override output filename (default: same as model name)
    """
    if not CADQUERY_AVAILABLE:
        raise RuntimeError("CadQuery is not installed.")

    name = str(params["name"])
    fmt = str(params.get("format", "STL")).upper()
    out_name = str(params.get("output_name", name))

    model = _get_model(name)

    format_suffix = {
        "STL": ".stl",
        "STEP": ".step",
        "OBJ": ".obj",
        "GLTF": ".gltf",
        "DXF": ".dxf",
        "SVG": ".svg",
    }
    if fmt not in format_suffix:
        raise ValueError(
            f"Unknown format '{fmt}'. Supported: {', '.join(format_suffix.keys())}."
        )

    out_path = _safe_output_path(out_name, EXPORTS_DIR, format_suffix[fmt])

    log.info("export_model: '%s' → %s (%s)", name, out_path, fmt)

    if fmt == "STL":
        cq.exporters.export(model, str(out_path), cq.exporters.ExportTypes.STL)
    elif fmt == "STEP":
        cq.exporters.export(model, str(out_path), cq.exporters.ExportTypes.STEP)
    elif fmt == "OBJ":
        # OBJ: trimesh round-trip
        if not TRIMESH_AVAILABLE:
            raise RuntimeError("trimesh is required for OBJ export. pip install trimesh")
        stl_tmp = _safe_output_path(f"{out_name}_tmp", EXPORTS_DIR, ".stl")
        cq.exporters.export(model, str(stl_tmp), cq.exporters.ExportTypes.STL)
        mesh = trimesh.load(str(stl_tmp))
        mesh.export(str(out_path))
        stl_tmp.unlink(missing_ok=True)
    elif fmt == "DXF":
        cq.exporters.export(model, str(out_path), cq.exporters.ExportTypes.DXF)
    elif fmt == "SVG":
        cq.exporters.export(model, str(out_path), cq.exporters.ExportTypes.SVG)
    elif fmt == "GLTF":
        # GLTF: trimesh round-trip via STL
        if not TRIMESH_AVAILABLE:
            raise RuntimeError("trimesh is required for GLTF export. pip install trimesh")
        stl_tmp = _safe_output_path(f"{out_name}_tmp", EXPORTS_DIR, ".stl")
        cq.exporters.export(model, str(stl_tmp), cq.exporters.ExportTypes.STL)
        mesh = trimesh.load(str(stl_tmp))
        mesh.export(str(out_path))
        stl_tmp.unlink(missing_ok=True)

    file_size = out_path.stat().st_size
    log.info("export_model: wrote %d bytes to %s", file_size, out_path)

    return {
        "name": name,
        "format": fmt,
        "path": str(out_path),
        "size_bytes": file_size,
        "message": f"Model '{name}' exported to {out_path.name}.",
    }


def handle_query_properties(params: dict[str, Any]) -> dict[str, Any]:
    """
    Calculate geometric properties of a model.

    Params:
        name (str): model identifier
        density (float, optional): g/cm³ — if provided, mass is also returned
    """
    if not CADQUERY_AVAILABLE:
        raise RuntimeError("CadQuery is not installed.")

    name = str(params["name"])
    density = float(params["density"]) if "density" in params else None

    model = _get_model(name)

    # CadQuery exposes a Shape object which we can query
    shape = model.val()

    bb = shape.BoundingBox()
    props = cq.Shape.computeMass(shape) if hasattr(cq.Shape, "computeMass") else None

    # Use OCP (CadQuery 2.7+) for precise volume/surface calculations
    # Fall back to bounding-box estimate if OCP GProp is not available
    try:
        from OCP.GProp import GProp_GProps  # type: ignore[import-untyped]
        from OCP.BRepGProp import BRepGProp  # type: ignore[import-untyped]

        vol_props = GProp_GProps()
        BRepGProp.VolumeProperties_s(shape.wrapped, vol_props)
        volume_mm3 = vol_props.Mass()

        surf_props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(shape.wrapped, surf_props)
        surface_area_mm2 = surf_props.Mass()

        cog = vol_props.CentreOfMass()
        center_of_mass = {"x": cog.X(), "y": cog.Y(), "z": cog.Z()}
    except (ImportError, Exception):
        # Bounding-box approximation fallback
        w = bb.xmax - bb.xmin
        d = bb.ymax - bb.ymin
        h = bb.zmax - bb.zmin
        volume_mm3 = w * d * h
        surface_area_mm2 = 2 * (w*d + d*h + w*h)
        center_of_mass = {
            "x": round((bb.xmin + bb.xmax) / 2, 4),
            "y": round((bb.ymin + bb.ymax) / 2, 4),
            "z": round((bb.zmin + bb.zmax) / 2, 4),
        }
        log.warning("OCP GProp not available — using bounding-box approximation.")

    result: dict[str, Any] = {
        "name": name,
        "volume_mm3": round(volume_mm3, 4),
        "surface_area_mm2": round(surface_area_mm2, 4),
        "bounding_box": {
            "xmin": round(bb.xmin, 4),
            "xmax": round(bb.xmax, 4),
            "ymin": round(bb.ymin, 4),
            "ymax": round(bb.ymax, 4),
            "zmin": round(bb.zmin, 4),
            "zmax": round(bb.zmax, 4),
            "width": round(bb.xmax - bb.xmin, 4),
            "depth": round(bb.ymax - bb.ymin, 4),
            "height": round(bb.zmax - bb.zmin, 4),
        },
        "center_of_mass": {k: round(v, 4) for k, v in center_of_mass.items()},
    }

    if density is not None:
        # volume in mm³ → cm³ (* 0.001), then * density (g/cm³) → grams
        mass_g = volume_mm3 * 0.001 * density
        result["density_g_cm3"] = density
        result["mass_g"] = round(mass_g, 4)
        result["mass_kg"] = round(mass_g / 1000, 6)

    log.info(
        "query_properties: '%s' vol=%.2f mm³  area=%.2f mm²",
        name,
        volume_mm3,
        surface_area_mm2,
    )
    return result


def handle_apply_operation(params: dict[str, Any]) -> dict[str, Any]:
    """
    Apply a geometric operation to an existing model.

    Params:
        name (str): source model identifier
        operation (str): extrude | revolve | fillet | chamfer | shell |
                         boolean_union | boolean_difference | boolean_intersection |
                         mirror | pattern_linear | pattern_circular
        output_name (str, optional): name for the result model (default: overwrites source)
        op_params (dict): operation-specific parameters
    """
    if not CADQUERY_AVAILABLE:
        raise RuntimeError("CadQuery is not installed.")

    name = str(params["name"])
    operation = str(params["operation"]).lower()
    out_name = str(params.get("output_name", name))
    op_p = params.get("op_params", {})

    model = _get_model(name)

    log.info("apply_operation: '%s' op=%s → '%s'", name, operation, out_name)

    if operation == "fillet":
        radius = _validate_dimension(float(op_p.get("radius", 1.0)), "radius")
        # Guard: fillet radius must be < half of the thinnest bounding-box dimension
        try:
            bb = model.val().BoundingBox()
            min_dim = min(bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin)
            max_safe = min_dim * 0.4  # conservative 40% limit
            if radius > max_safe:
                raise ValueError(
                    f"Fillet radius {radius}mm is too large for this geometry. "
                    f"Thinnest dimension is {min_dim:.1f}mm so max safe radius is ~{max_safe:.1f}mm. "
                    f"Use radius ≤ {max_safe:.1f}mm."
                )
        except ValueError:
            raise
        except Exception:
            pass  # skip guard if BoundingBox fails
        try:
            result = model.edges().fillet(radius)
        except Exception as e:
            err = str(e)
            if "BRep_API" in err or "command not done" in err.lower():
                raise ValueError(
                    f"Fillet radius {radius}mm failed (BRep error). "
                    "The radius is probably too large for the geometry. "
                    "Try a smaller radius — rule of thumb: radius ≤ 40% of thinnest wall."
                ) from e
            raise

    elif operation == "chamfer":
        length = _validate_dimension(float(op_p.get("length", 1.0)), "length")
        result = model.edges().chamfer(length)

    elif operation == "shell":
        thickness = float(op_p.get("thickness", -1.0))
        if thickness == 0:
            raise ValueError("Shell thickness cannot be 0.")
        result = model.shell(thickness)

    elif operation == "extrude":
        # Extrude requires a 2D face selection — operate on the top face
        distance = _validate_dimension(float(op_p.get("distance", 5.0)), "distance")
        result = model.faces(">Z").wires().toPending().extrude(distance)

    elif operation == "revolve":
        angle = float(op_p.get("angle", 360.0))
        axis_origin = op_p.get("axis_origin", [0, 0, 0])
        axis_dir = op_p.get("axis_dir", [0, 1, 0])
        result = model.revolve(angle, axisStart=axis_origin, axisEnd=axis_dir)

    elif operation in ("boolean_union", "boolean_difference", "boolean_intersection"):
        other_name = str(op_p.get("other_model", op_p.get("other", "")))
        other = _get_model(other_name)
        if operation == "boolean_union":
            result = model.union(other).clean()
        elif operation == "boolean_difference":
            result = model.cut(other).clean()
        else:
            result = model.intersect(other).clean()

    elif operation == "mirror":
        plane = str(op_p.get("plane", "XY")).upper()
        result = model.mirror(plane)

    elif operation == "pattern_linear":
        direction = str(op_p.get("direction", "X")).upper()
        spacing = _validate_dimension(float(op_p.get("spacing", 10.0)), "spacing")
        count = int(op_p.get("count", 2))
        if count < 1:
            raise ValueError("count must be >= 1")
        axis_map = {"X": (1, 0, 0), "Y": (0, 1, 0), "Z": (0, 0, 1)}
        d = axis_map.get(direction, (1, 0, 0))
        result = model.rarray(spacing, 1, count, 1).add(model.val())  # simplification
        result = model  # placeholder — full array implementation below
        shapes = [model.val()]
        for i in range(1, count):
            moved = model.translate((d[0] * spacing * i, d[1] * spacing * i, d[2] * spacing * i))
            shapes.append(moved.val())
        compound = cq.Workplane("XY").add(cq.Compound.makeCompound(shapes))
        result = compound

    elif operation == "pattern_circular":
        count = int(op_p.get("count", 4))
        radius = _validate_dimension(float(op_p.get("radius", 10.0)), "radius")
        if count < 1:
            raise ValueError("count must be >= 1")
        result = model.polarArray(radius, 0, 360, count)

    else:
        raise ValueError(
            f"Unknown operation '{operation}'. Supported: fillet, chamfer, shell, extrude, "
            "revolve, boolean_union, boolean_difference, boolean_intersection, "
            "mirror, pattern_linear, pattern_circular."
        )

    _models[out_name] = result

    return {
        "name": out_name,
        "operation": operation,
        "source": name,
        "message": f"Operation '{operation}' applied. Result stored as '{out_name}'.",
    }


def handle_render_preview(params: dict[str, Any]) -> dict[str, Any]:
    """
    Render a PNG preview of a model.

    Params:
        name (str): model identifier
        output_name (str, optional): filename for the PNG (default: {name}_preview)
        azimuth (float, optional): camera azimuth degrees (default 45)
        elevation (float, optional): camera elevation degrees (default 30)
        width (int, optional): image width px (default 800)
        height (int, optional): image height px (default 600)
        background (str, optional): "dark" (default), "light", or "transparent"
    """
    name = str(params["name"])
    out_name = str(params.get("output_name", f"{name}_preview"))
    azimuth = float(params.get("azimuth", 45))
    elevation = float(params.get("elevation", 30))
    img_w = int(params.get("width", 800))
    img_h = int(params.get("height", 600))
    background = str(params.get("background", "dark")).lower()

    if background not in ("dark", "light", "transparent"):
        raise ValueError(f"Invalid background '{background}'. Must be 'dark', 'light', or 'transparent'.")

    # Resolve background/foreground colours
    if background == "dark":
        bg_color = "#1a1a2e"
        fg_color = "#aaaaaa"
        title_color = "#ffffff"
        edge_color = "#ffffff22"
    elif background == "light":
        bg_color = "#ffffff"
        fg_color = "#333333"
        title_color = "#000000"
        edge_color = "#00000022"
    else:  # transparent — use white as working colour then save with alpha
        bg_color = "none"
        fg_color = "#333333"
        title_color = "#000000"
        edge_color = "#00000022"

    if not CADQUERY_AVAILABLE:
        raise RuntimeError("CadQuery is not installed.")
    if not TRIMESH_AVAILABLE:
        raise RuntimeError("trimesh is required for rendering. pip install trimesh")

    import numpy as np  # type: ignore[import-untyped]
    import matplotlib  # type: ignore[import-untyped]
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt  # type: ignore[import-untyped]
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # type: ignore[import-untyped]

    model = _get_model(name)

    # Export to a temporary STL and load with trimesh
    stl_tmp = _safe_output_path(f"{out_name}_render_tmp", EXPORTS_DIR, ".stl")
    cq.exporters.export(model, str(stl_tmp), cq.exporters.ExportTypes.STL)
    mesh = trimesh.load(str(stl_tmp))
    stl_tmp.unlink(missing_ok=True)

    # Build matplotlib 3D preview
    fig = plt.figure(figsize=(img_w / 100, img_h / 100), dpi=100, facecolor=bg_color)
    ax = fig.add_subplot(111, projection="3d", facecolor=bg_color)

    verts = [mesh.vertices[face] for face in mesh.faces]
    poly = Poly3DCollection(
        verts, alpha=0.85, linewidths=0.2, edgecolors=edge_color
    )
    poly.set_facecolor("#4a9eff")
    ax.add_collection3d(poly)

    scale = mesh.vertices.flatten()
    ax.auto_scale_xyz(scale, scale, scale)
    ax.view_init(elev=elevation, azim=azimuth)

    for pane in [ax.xaxis.pane, ax.yaxis.pane, ax.zaxis.pane]:
        pane.fill = False
        pane.set_edgecolor(edge_color)

    ax.tick_params(colors=fg_color, labelsize=7)
    ax.set_xlabel("X (mm)", color=fg_color, fontsize=8)
    ax.set_ylabel("Y (mm)", color=fg_color, fontsize=8)
    ax.set_zlabel("Z (mm)", color=fg_color, fontsize=8)
    ax.set_title(f"Model: {name}", color=title_color, fontsize=10, pad=12)

    out_path = _safe_output_path(out_name, PREVIEWS_DIR, ".png")
    plt.tight_layout()
    save_kwargs: dict[str, Any] = {"dpi": 100, "bbox_inches": "tight"}
    if background == "transparent":
        save_kwargs["transparent"] = True
    else:
        save_kwargs["facecolor"] = fig.get_facecolor()
    plt.savefig(str(out_path), **save_kwargs)
    plt.close(fig)

    file_size = out_path.stat().st_size
    log.info("render_preview: wrote %d bytes to %s", file_size, out_path)

    return {
        "name": name,
        "path": str(out_path),
        "size_bytes": file_size,
        "resolution": f"{img_w}x{img_h}",
        "background": background,
        "message": f"Preview for '{name}' saved to {out_path.name}.",
    }


def handle_validate_model(params: dict[str, Any]) -> dict[str, Any]:
    """
    Validate a model for 3D printability.

    Params:
        name (str): model identifier
        min_wall_thickness (float, optional): minimum wall thickness in mm (default 1.5)
    """
    from validators import validate_mesh  # type: ignore[import-not-found]

    if not CADQUERY_AVAILABLE:
        raise RuntimeError("CadQuery is not installed.")
    if not TRIMESH_AVAILABLE:
        raise RuntimeError("trimesh is required for validation. pip install trimesh")

    name = str(params["name"])
    min_thickness = float(params.get("min_wall_thickness", 1.5))

    model = _get_model(name)

    stl_tmp = _safe_output_path(f"{name}_validate_tmp", EXPORTS_DIR, ".stl")
    cq.exporters.export(model, str(stl_tmp), cq.exporters.ExportTypes.STL)

    try:
        result = validate_mesh(str(stl_tmp), min_wall_thickness=min_thickness)
    finally:
        stl_tmp.unlink(missing_ok=True)

    log.info(
        "validate_model: '%s' valid=%s issues=%d",
        name,
        result["is_valid"],
        len(result.get("issues", [])),
    )
    return {"name": name, **result}


def handle_list_templates(params: dict[str, Any]) -> dict[str, Any]:
    """List available templates from the template library."""
    category = params.get("category")  # optional filter

    templates: list[dict[str, Any]] = []
    search_dirs = (
        [TEMPLATES_DIR / category]
        if category
        else [TEMPLATES_DIR / d for d in ("mechanical", "architectural", "organic")]
    )

    for d in search_dirs:
        if not d.exists():
            continue
        for fn in d.glob("*.json"):
            try:
                meta = json.loads(fn.read_text(encoding="utf-8"))
                templates.append(
                    {
                        "id": fn.stem,
                        "category": d.name,
                        "name": meta.get("name", fn.stem),
                        "description": meta.get("description", ""),
                        "parameters": meta.get("parameters", {}),
                    }
                )
            except Exception:
                pass  # skip malformed templates

    return {"templates": templates, "count": len(templates)}


def handle_load_template(params: dict[str, Any]) -> dict[str, Any]:
    """
    Instantiate a template with given parameters.

    Params:
        template_id (str): template name (matches JSON filename in templates/)
        parameters (dict): override default parameter values
        output_name (str): name for the resulting model
    """
    template_id = str(params["template_id"])
    override_params = params.get("parameters", {})
    out_name = str(params.get("output_name", template_id))

    # Search all category directories
    template_file: Path | None = None
    for category in ("mechanical", "architectural", "organic"):
        candidate = TEMPLATES_DIR / category / f"{template_id}.json"
        if candidate.exists():
            template_file = candidate
            break

    if template_file is None:
        raise FileNotFoundError(
            f"Template '{template_id}' not found in any category directory."
        )
    assert template_file is not None  # narrow type for Pyre2

    template = json.loads(template_file.read_text(encoding="utf-8"))
    merged_params = {**template.get("parameters", {}), **override_params}

    # Re-use create_model with the template's base shape
    create_params = {
        "base_shape": template.get("base_shape", "box"),
        "parameters": merged_params,
        "output_name": out_name,
        "description": f"Template: {template_id}",
        "units": template.get("units", "mm"),
    }
    result = handle_create_model(create_params)
    result["template_id"] = template_id
    return result


def handle_import_file(params: dict[str, Any]) -> dict[str, Any]:
    """
    Import an existing STL/STEP/OBJ file into the workspace.

    Params:
        path (str): absolute or relative path to the file
        output_name (str, optional): name for the model in memory
    """
    if not CADQUERY_AVAILABLE:
        raise RuntimeError("CadQuery is not installed.")

    file_path = Path(params["path"]).resolve()
    out_name = str(params.get("output_name", file_path.stem))

    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    suffix = file_path.suffix.lower()
    if suffix not in (".stl", ".step", ".stp", ".obj"):
        raise ValueError(f"Unsupported import format '{suffix}'. Supported: .stl, .step, .stp, .obj")

    log.info("import_file: %s → model '%s'", file_path, out_name)

    if suffix == ".stl":
        model = cq.importers.importStep(str(file_path)) if False else None
        # Use trimesh for STL, rehydrate as CQ shape
        if TRIMESH_AVAILABLE:
            mesh = trimesh.load(str(file_path))
            # Store raw trimesh — a simplified approach
            _models[out_name] = mesh
        else:
            raise RuntimeError("trimesh required for STL import. pip install trimesh")
    elif suffix in (".step", ".stp"):
        model = cq.importers.importStep(str(file_path))
        _models[out_name] = model
    elif suffix == ".obj":
        if not TRIMESH_AVAILABLE:
            raise RuntimeError("trimesh required for OBJ import. pip install trimesh")
        mesh = trimesh.load(str(file_path))
        _models[out_name] = mesh

    return {
        "name": out_name,
        "source_path": str(file_path),
        "format": suffix.lstrip(".").upper(),
        "message": f"File imported as model '{out_name}'.",
    }


def handle_sketch_2d(params: dict[str, Any]) -> dict[str, Any]:
    """
    Create a 2D sketch for use with extrusion.

    Params:
        output_name (str): name for the resulting sketch model
        plane (str): XY | XZ | YZ (default XY)
        elements (list): list of sketch elements
            Each element: {"type": "line|arc|circle|rect", ...}
    """
    if not CADQUERY_AVAILABLE:
        raise RuntimeError("CadQuery is not installed.")

    out_name = str(params.get("output_name", "sketch"))
    plane = str(params.get("plane", "XY")).upper()
    elements = params.get("elements", [])

    if plane not in ("XY", "XZ", "YZ"):
        raise ValueError(f"Invalid plane '{plane}'. Use XY, XZ, or YZ.")

    wp = cq.Workplane(plane)

    for elem in elements:
        etype = str(elem.get("type", "")).lower()

        if etype == "rect":
            w = _validate_dimension(float(elem.get("width", 10)), "width")
            h = _validate_dimension(float(elem.get("height", 10)), "height")
            wp = wp.rect(w, h)

        elif etype == "circle":
            r = _validate_dimension(float(elem.get("radius", 5)), "radius")
            cx = float(elem.get("cx", 0))
            cy = float(elem.get("cy", 0))
            wp = wp.moveTo(cx, cy).circle(r)

        elif etype == "line":
            x1, y1 = float(elem.get("x1", 0)), float(elem.get("y1", 0))
            x2, y2 = float(elem.get("x2", 10)), float(elem.get("y2", 0))
            wp = wp.moveTo(x1, y1).lineTo(x2, y2)

        elif etype == "arc":
            x1, y1 = float(elem.get("x1", 0)), float(elem.get("y1", 0))
            x2, y2 = float(elem.get("x2", 10)), float(elem.get("y2", 0))
            xm, ym = float(elem.get("xm", 5)), float(elem.get("ym", 5))
            wp = wp.moveTo(x1, y1).threePointArc((xm, ym), (x2, y2))

        else:
            log.warning("sketch_2d: unknown element type '%s', skipping", etype)

    _models[out_name] = wp

    return {
        "name": out_name,
        "plane": plane,
        "element_count": len(elements),
        "message": f"Sketch '{out_name}' created on plane {plane} with {len(elements)} elements.",
    }


def handle_ansys_simulate(params: dict[str, Any]) -> dict[str, Any]:
    """
    Run a finite element analysis (FEA) on a model using ANSYS MAPDL.

    Replaces the Blender render tool with engineering-grade simulation.

    Params:
        name (str): model identifier to simulate
        analysis_type (str): structural | modal | thermal
        material (str | dict): material preset name OR custom props dict
            Presets: steel, aluminum, stainless_steel, titanium, pla, nylon, abs
        boundary_conditions (list, optional): list of BC dicts
            [{"type": "fixed", "face": "bottom"}, ...]
        loads (list, optional): list of load dicts
            [{"type": "pressure", "face": "top", "value_mpa": 1.0}, ...]
        mesh_size_mm (float, optional): FE mesh element size in mm (default 5.0)
        output_name (str, optional): stem for result files

    Returns (structural):
        max_von_mises_stress_mpa, max_deformation_mm, safety_factor, status (PASS/WARN/FAIL)
    Returns (modal):
        natural_frequencies_hz, mode_count
    Returns (thermal):
        max_temperature_c, min_temperature_c, max_heat_flux_w_m2
    """
    if not CADQUERY_AVAILABLE:
        raise RuntimeError("CadQuery is not installed.")

    name = str(params["name"])
    analysis_type = str(params.get("analysis_type", "structural")).lower()
    material = params.get("material", "steel")
    boundary_conditions = params.get("boundary_conditions", [{"type": "fixed", "face": "bottom"}])
    loads = params.get("loads", [])
    mesh_size_mm = float(params.get("mesh_size_mm", 5.0))
    out_name = str(params.get("output_name", f"{name}_{analysis_type}"))

    if analysis_type not in ("structural", "modal", "thermal"):
        raise ValueError(
            f"Unknown analysis_type '{analysis_type}'. Supported: structural, modal, thermal."
        )

    # Export model to STEP — the format ANSYS MAPDL reads best
    model = _get_model(name)
    step_path = _safe_output_path(f"{out_name}_ansys_input", EXPORTS_DIR, ".step")
    if not isinstance(model, type(None)) and CADQUERY_AVAILABLE:
        cq.exporters.export(model, str(step_path), cq.exporters.ExportTypes.STEP)

    results_dir = EXPORTS_DIR / "ansys_results"
    results_dir.mkdir(parents=True, exist_ok=True)

    # Delegate to the ANSYS bridge
    try:
        import sys as _sys
        _sys.path.insert(0, str(Path(__file__).parent))
        from ansys_bridge import run_simulation  # type: ignore[import-not-found]

        result = run_simulation(
            step_file=str(step_path),
            analysis_type=analysis_type,
            material=material,
            boundary_conditions=boundary_conditions,
            loads=loads,
            output_dir=str(results_dir),
            output_name=out_name,
            mesh_size_mm=mesh_size_mm,
        )
    except ImportError:
        from ansys_bridge import _fallback_result, _resolve_material  # type: ignore[import-not-found]
        result = _fallback_result(
            analysis_type=analysis_type,
            reason="ansys_bridge.py could not be imported.",
            mat_props=_resolve_material(material),
        )
    finally:
        step_path.unlink(missing_ok=True)

    log.info(
        "ansys_simulate: '%s' type=%s ansys_available=%s",
        name,
        analysis_type,
        result.get("ansys_available", True),
    )
    return {"name": name, "analysis_type": analysis_type, **result}


def handle_ansys_list_materials(_params: dict[str, Any]) -> dict[str, Any]:
    """Return all available ANSYS material presets."""
    try:
        from ansys_bridge import list_materials  # type: ignore[import-not-found]
        return list_materials()
    except ImportError:
        # Inline fallback
        from ansys_bridge import MATERIAL_PRESETS  # type: ignore[import-not-found]
        return {
            "materials": [{"name": k, **v} for k, v in MATERIAL_PRESETS.items()],
            "count": len(MATERIAL_PRESETS),
        }

def handle_translate_model(params: dict[str, Any]) -> dict[str, Any]:
    """
    Translate (move) a model by a (x, y, z) offset.

    Params:
        name (str): source model identifier
        x, y, z (float): translation offsets in mm (default 0)
        output_name (str, optional): result model name (default: overwrites source)

    Example: move arm 45mm in X and 45mm in Y before unioning with body
    """
    if not CADQUERY_AVAILABLE:
        raise RuntimeError("CadQuery is not installed.")

    name = str(params["name"])
    x = float(params.get("x", 0.0))
    y = float(params.get("y", 0.0))
    z = float(params.get("z", 0.0))
    out_name = str(params.get("output_name", name))

    model = _get_model(name)
    result = model.translate((x, y, z))
    _models[out_name] = result

    log.info("translate_model: '%s' by (%g, %g, %g) → '%s'", name, x, y, z, out_name)
    return {
        "name": out_name,
        "source": name,
        "translation": {"x": x, "y": y, "z": z},
        "message": f"Model '{name}' translated by ({x}, {y}, {z}mm) → stored as '{out_name}'.",
    }


def handle_repair_mesh(params: dict[str, Any]) -> dict[str, Any]:
    """
    Repair a model's mesh for 3D printing.

    Exports to STL, repairs with trimesh (winding, normals, holes, degenerate/duplicate
    faces), then saves the repaired STL to the exports directory.

    Params:
        name (str): in-memory model identifier
        output_name (str, optional): repaired file stem (default: <name>_repaired)

    Returns: path, is_watertight, faces_before, faces_after, size_bytes
    """
    if not CADQUERY_AVAILABLE:
        raise RuntimeError("CadQuery is not installed.")
    if not TRIMESH_AVAILABLE:
        raise RuntimeError("trimesh is required for mesh repair — pip install trimesh")

    name = str(params["name"])
    out_name = str(params.get("output_name", f"{name}_repaired"))

    model = _get_model(name)

    # Export to a temp STL
    tmp_stl = _safe_output_path(f"{name}_repair_tmp", EXPORTS_DIR, ".stl")
    cq.exporters.export(model, str(tmp_stl), cq.exporters.ExportTypes.STL)

    # Load with trimesh — force=mesh avoids returning a Scene for multi-body STLs
    raw = trimesh.load(str(tmp_stl), force="mesh")
    if isinstance(raw, trimesh.scene.scene.Scene):
        mesh = trimesh.util.concatenate(list(raw.geometry.values()))
    else:
        mesh = raw
    faces_before = int(len(mesh.faces))

    # Repair sequence — using trimesh 4.x compatible API
    # mesh.process() removes duplicate verts/faces and degenerate tris
    try:
        mesh.process(validate=True)
    except Exception:
        mesh.process(validate=False)
    for fn in (
        trimesh.repair.fix_winding,
        trimesh.repair.fix_normals,
        trimesh.repair.fix_inversion,
        trimesh.repair.fill_holes,
    ):
        try:
            fn(mesh)
        except Exception as e:
            log.warning("repair_mesh: %s skipped: %s", fn.__name__, e)

    faces_after = int(len(mesh.faces))

    # Save repaired STL
    out_path = _safe_output_path(out_name, EXPORTS_DIR, ".stl")
    mesh.export(str(out_path))
    tmp_stl.unlink(missing_ok=True)

    # Keep the original CadQuery model available under the output name
    # so downstream tools (validate_model, export STEP) still work.
    # The repaired STL is what's saved to disk; _models[out_name] gives
    # access to the BRep for STEP export.
    _models[out_name] = model

    log.info("repair_mesh: '%s' → '%s' watertight=%s faces %d→%d",
             name, out_name, mesh.is_watertight, faces_before, faces_after)
    return {
        "name": out_name,
        "source": name,
        "stl_path": str(out_path),
        "is_watertight": bool(mesh.is_watertight),
        "faces_before": faces_before,
        "faces_after": faces_after,
        "size_bytes": out_path.stat().st_size,
        "message": (
            f"Mesh repaired: {faces_before}→{faces_after} faces, "
            f"watertight={mesh.is_watertight}. "
            f"Repaired STL saved to {out_path.name}. "
            f"Use cad_export_model name='{out_name}' format='STEP' for STEP export."
        ),
    }


# ===========================================================================
# JSON-RPC dispatcher
# ===========================================================================

_HANDLERS = {
    "create_model":             handle_create_model,
    "export_model":             handle_export_model,
    "query_properties":         handle_query_properties,
    "apply_operation":          handle_apply_operation,
    "render_preview":           handle_render_preview,
    "translate_model":          handle_translate_model,
    "repair_mesh":              handle_repair_mesh,
    "validate_model":           handle_validate_model,
    "list_templates":           handle_list_templates,
    "load_template":            handle_load_template,
    "import_file":              handle_import_file,
    "sketch_2d":                handle_sketch_2d,
    "ping": lambda _: {"pong": True},
}

# JSON-RPC error codes
ERR_PARSE = -32700
ERR_INVALID_REQUEST = -32600
ERR_METHOD_NOT_FOUND = -32601
ERR_INVALID_PARAMS = -32602
ERR_INTERNAL = -32603
ERR_CAD = -32000  # custom: geometry error


def _make_error(req_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def _make_result(req_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def dispatch(raw: str) -> dict[str, Any]:
    """Parse one JSON-RPC request line and dispatch to the correct handler."""
    try:
        req = json.loads(raw)
    except json.JSONDecodeError as exc:
        return _make_error(None, ERR_PARSE, f"Parse error: {exc}")

    req_id = req.get("id")
    method = req.get("method")
    params = req.get("params", {})

    if not isinstance(method, str):
        return _make_error(req_id, ERR_INVALID_REQUEST, "Missing or invalid 'method'.")

    handler = _HANDLERS.get(method)
    if handler is None:
        return _make_error(req_id, ERR_METHOD_NOT_FOUND, f"Method '{method}' not found.")

    try:
        result = handler(params)
        return _make_result(req_id, result)
    except (TypeError, ValueError, KeyError) as exc:
        log.error("Invalid params for '%s': %s", method, exc)
        return _make_error(req_id, ERR_INVALID_PARAMS, str(exc))
    except FileNotFoundError as exc:
        log.error("File not found in '%s': %s", method, exc)
        return _make_error(req_id, ERR_INVALID_PARAMS, str(exc))
    except Exception as exc:
        log.error("Error in '%s': %s\n%s", method, exc, traceback.format_exc())
        return _make_error(req_id, ERR_CAD, f"[{method}] {exc}")


# ===========================================================================
# Main loop
# ===========================================================================

def main() -> None:
    log.info("cadquery_server started. PID=%d", os.getpid())
    print(
        json.dumps({"jsonrpc": "2.0", "method": "server_ready", "params": {}}),
        flush=True,
    )

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        log.debug("recv: %s", line[:200])  # pyre-ignore[16]
        response = dispatch(line)
        out = json.dumps(response)
        log.debug("send: %s", out[:200])  # pyre-ignore[16]
        print(out, flush=True)

    log.info("cadquery_server shutting down (stdin closed).")


if __name__ == "__main__":
    main()
