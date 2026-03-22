"""
tests/test_validators.py — Unit tests for the mesh validator.
Run with: cd python && pytest tests/ -v
"""

import json
import os
import struct
import sys
from pathlib import Path

import pytest

# Ensure we can import from the python/ directory
sys.path.insert(0, str(Path(__file__).parent.parent))

from validators import validate_mesh  # type: ignore[import-not-found]


# ---------------------------------------------------------------------------
# Helpers to generate minimal binary STL files for testing
# ---------------------------------------------------------------------------

def _write_binary_stl(path: Path, triangles: list[tuple]) -> None:
    """Write a minimal binary STL. triangles: list of (normal, v1, v2, v3)."""
    with open(path, "wb") as f:
        f.write(b"\x00" * 80)  # header
        f.write(struct.pack("<I", len(triangles)))
        for normal, v1, v2, v3 in triangles:
            f.write(struct.pack("<fff", *normal))
            f.write(struct.pack("<fff", *v1))
            f.write(struct.pack("<fff", *v2))
            f.write(struct.pack("<fff", *v3))
            f.write(struct.pack("<H", 0))  # attribute


def _make_box_triangles() -> list[tuple]:
    """12 triangles forming a 10×10×10 mm closed box."""
    # Vertices of a unit cube scaled to 10 mm
    verts = [
        (0, 0, 0), (10, 0, 0), (10, 10, 0), (0, 10, 0),  # bottom
        (0, 0, 10), (10, 0, 10), (10, 10, 10), (0, 10, 10),  # top
    ]
    faces = [
        # bottom (normal 0,0,-1)
        ((0, 0, -1), verts[0], verts[2], verts[1]),
        ((0, 0, -1), verts[0], verts[3], verts[2]),
        # top (normal 0,0,1)
        ((0, 0, 1), verts[4], verts[5], verts[6]),
        ((0, 0, 1), verts[4], verts[6], verts[7]),
        # front (normal 0,-1,0)
        ((0, -1, 0), verts[0], verts[1], verts[5]),
        ((0, -1, 0), verts[0], verts[5], verts[4]),
        # back (normal 0,1,0)
        ((0, 1, 0), verts[2], verts[3], verts[7]),
        ((0, 1, 0), verts[2], verts[7], verts[6]),
        # left (normal -1,0,0)
        ((-1, 0, 0), verts[0], verts[4], verts[7]),
        ((-1, 0, 0), verts[0], verts[7], verts[3]),
        # right (normal 1,0,0)
        ((1, 0, 0), verts[1], verts[2], verts[6]),
        ((1, 0, 0), verts[1], verts[6], verts[5]),
    ]
    return faces


@pytest.fixture
def box_stl(tmp_path: Path) -> Path:
    path = tmp_path / "box.stl"
    _write_binary_stl(path, _make_box_triangles())
    return path


@pytest.fixture
def empty_stl(tmp_path: Path) -> Path:
    """STL with no triangles — open/invalid mesh."""
    path = tmp_path / "empty.stl"
    _write_binary_stl(path, [])
    return path


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestValidateMesh:
    def test_returns_dict(self, box_stl: Path) -> None:
        result = validate_mesh(str(box_stl))
        assert isinstance(result, dict)

    def test_required_keys(self, box_stl: Path) -> None:
        result = validate_mesh(str(box_stl))
        for key in ("is_valid", "is_watertight", "issues", "info"):
            assert key in result, f"Missing key: {key}"

    def test_box_is_watertight(self, box_stl: Path) -> None:
        result = validate_mesh(str(box_stl))
        assert result["is_watertight"] is True

    def test_box_is_valid(self, box_stl: Path) -> None:
        result = validate_mesh(str(box_stl))
        assert result["is_valid"] is True

    def test_box_no_issues(self, box_stl: Path) -> None:
        result = validate_mesh(str(box_stl))
        assert result["issues"] == []

    def test_info_has_face_count(self, box_stl: Path) -> None:
        result = validate_mesh(str(box_stl))
        assert result["info"]["face_count"] == 12

    def test_missing_file_returns_error(self, tmp_path: Path) -> None:
        result = validate_mesh(str(tmp_path / "nonexistent.stl"))
        assert result["is_valid"] is False
        assert len(result["issues"]) > 0

    def test_min_wall_thickness_warning(self, tmp_path: Path) -> None:
        """A very thin flat box should trigger a thin-wall warning."""
        thin_faces = [
            ((0, 0, -1), (0, 0, 0), (10, 0, 0), (10, 10, 0)),
            ((0, 0, -1), (0, 0, 0), (10, 10, 0), (0, 10, 0)),
            ((0, 0, 1),  (0, 0, 0.5), (10, 0, 0.5), (10, 10, 0.5)),
            ((0, 0, 1),  (0, 0, 0.5), (10, 10, 0.5), (0, 10, 0.5)),
            ((0, -1, 0), (0, 0, 0), (10, 0, 0), (10, 0, 0.5)),
            ((0, -1, 0), (0, 0, 0), (10, 0, 0.5), (0, 0, 0.5)),
            ((0, 1, 0),  (0, 10, 0), (10, 10, 0.5), (10, 10, 0)),
            ((0, 1, 0),  (0, 10, 0), (0, 10, 0.5), (10, 10, 0.5)),
            ((-1, 0, 0), (0, 0, 0), (0, 10, 0), (0, 10, 0.5)),
            ((-1, 0, 0), (0, 0, 0), (0, 10, 0.5), (0, 0, 0.5)),
            ((1, 0, 0),  (10, 0, 0), (10, 0, 0.5), (10, 10, 0.5)),
            ((1, 0, 0),  (10, 0, 0), (10, 10, 0.5), (10, 10, 0)),
        ]
        path = tmp_path / "thin.stl"
        _write_binary_stl(path, thin_faces)
        result = validate_mesh(str(path), min_wall_thickness=1.5)
        assert result["thin_wall_warning"] is True
        assert any("1.5" in issue or "0." in issue for issue in result["issues"])
