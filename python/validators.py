"""
validators.py — Mesh validation utilities for 3D printability checks.

Uses trimesh for geometry analysis. Called by cadquery_server.py.
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("cadquery_server.validators")


def validate_mesh(
    stl_path: str,
    *,
    min_wall_thickness: float = 1.5,
) -> dict[str, Any]:
    """
    Validate a mesh (loaded from STL) for 3D printability.

    Returns a dict with:
        is_valid (bool): True if no critical issues found
        is_watertight (bool): mesh is closed / manifold
        is_winding_consistent (bool): face normals are consistent
        non_manifold_edge_count (int): number of non-manifold edges
        issues (list[str]): human-readable list of issues
        info (dict): additional metadata
    """
    try:
        import trimesh  # type: ignore[import-untyped]
    except ImportError:
        return {
            "is_valid": False,
            "issues": ["trimesh is not installed — cannot validate. pip install trimesh"],
        }

    try:
        mesh = trimesh.load(stl_path, force="mesh")
    except Exception as exc:
        return {
            "is_valid": False,
            "issues": [f"Failed to load mesh for validation: {exc}"],
        }

    issues: list[str] = []

    # ── Watertight / manifold check ──────────────────────────────────────────
    is_watertight: bool = bool(mesh.is_watertight)
    if not is_watertight:
        issues.append("Mesh is NOT watertight (open edges detected). Fix before 3D printing.")

    # ── Consistent winding ────────────────────────────────────────────────────
    is_winding_consistent: bool = bool(mesh.is_winding_consistent)
    if not is_winding_consistent:
        issues.append("Face normals are NOT consistently oriented. May cause slicing errors.")

    # ── Non-manifold edges ────────────────────────────────────────────────────
    unique_edges = mesh.edges_unique
    edge_counts = mesh.edges_unique_length  # reusing trimesh util
    # Real non-manifold check: edges shared by ≠ 2 faces
    try:
        body_count = len(mesh.split(only_watertight=False))
    except Exception:
        body_count = 1

    # trimesh provides this via mesh.is_volume for non-manifold check
    non_manifold_count = 0
    try:
        edges = mesh.edges_sorted
        from collections import Counter
        edge_face_count = Counter(map(tuple, edges))
        non_manifold_count = sum(1 for c in edge_face_count.values() if c != 2)
        if non_manifold_count > 0:
            issues.append(
                f"Mesh has {non_manifold_count} non-manifold edge(s). "
                "These may cause geometry errors during slicing."
            )
    except Exception:
        pass  # skip if edge counting fails

    # ── Degenerate faces ──────────────────────────────────────────────────────
    degenerate_count = 0
    try:
        areas = mesh.area_faces
        degenerate_count = int((areas < 1e-10).sum())
        if degenerate_count > 0:
            issues.append(
                f"Mesh has {degenerate_count} degenerate face(s) with near-zero area."
            )
    except Exception:
        pass

    # ── Volume check (positive = right-handed winding) ───────────────────────
    volume = 0.0
    try:
        if is_watertight:
            volume = float(mesh.volume)
            if volume <= 0:
                issues.append(
                    f"Mesh volume is {volume:.4f} mm³ (non-positive). "
                    "Face normals may be inverted."
                )
    except Exception:
        pass

    # ── Wall-thickness estimation (bounding-box proxy) ────────────────────────
    bb_extents = mesh.bounding_box.extents  # (x, y, z) lengths
    min_extent = float(min(bb_extents)) if len(bb_extents) == 3 else 0.0
    thin_wall_warning = False
    if 0 < min_extent < min_wall_thickness:
        thin_wall_warning = True
        issues.append(
            f"Bounding box thinnest dimension is {min_extent:.2f} mm, "
            f"below the minimum wall thickness of {min_wall_thickness:.2f} mm."
        )

    is_valid = is_watertight and is_winding_consistent and non_manifold_count == 0

    return {
        "is_valid": is_valid,
        "is_watertight": is_watertight,
        "is_winding_consistent": is_winding_consistent,
        "non_manifold_edge_count": non_manifold_count,
        "degenerate_face_count": degenerate_count,
        "volume_mm3": round(volume, 4),
        "thin_wall_warning": thin_wall_warning,
        "issues": issues,
        "info": {
            "face_count": len(mesh.faces),
            "vertex_count": len(mesh.vertices),
            "body_count": body_count,
            "bounding_box_mm": {
                "x": round(float(bb_extents[0]), 4),
                "y": round(float(bb_extents[1]), 4),
                "z": round(float(bb_extents[2]), 4),
            },
        },
    }
