"""
conftest.py — pytest fixtures shared across all test files.
"""

import os
import sys
from pathlib import Path
import pytest

# Ensure the python/ directory is on sys.path so imports resolve
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture(scope="session", autouse=True)
def ensure_dirs(tmp_path_factory: pytest.TempPathFactory) -> None:
    """Create the output directories expected by cadquery_server.py."""
    project_root = Path(__file__).parent.parent.parent
    for d in ["models/exports", "models/previews", "logs"]:
        (project_root / d).mkdir(parents=True, exist_ok=True)


@pytest.fixture
def sample_stl_box(tmp_path: Path) -> Path:
    """Write a minimal watertight binary STL box (10×10×10 mm) for testing."""
    import struct

    triangles = [
        ((0,0,-1),(0,0,0),(10,0,0),(10,10,0)),
        ((0,0,-1),(0,0,0),(10,10,0),(0,10,0)),
        ((0,0,1), (0,0,10),(10,0,10),(10,10,10)),
        ((0,0,1), (0,0,10),(10,10,10),(0,10,10)),
        ((0,-1,0),(0,0,0),(10,0,0),(10,0,10)),
        ((0,-1,0),(0,0,0),(10,0,10),(0,0,10)),
        ((0,1,0), (0,10,0),(10,10,10),(10,10,0)),
        ((0,1,0), (0,10,0),(0,10,10),(10,10,10)),
        ((-1,0,0),(0,0,0),(0,10,0),(0,10,10)),
        ((-1,0,0),(0,0,0),(0,10,10),(0,0,10)),
        ((1,0,0), (10,0,0),(10,0,10),(10,10,10)),
        ((1,0,0), (10,0,0),(10,10,10),(10,10,0)),
    ]
    path = tmp_path / "sample_box.stl"
    with open(path, "wb") as f:
        f.write(b"\x00" * 80)
        f.write(struct.pack("<I", len(triangles)))
        for n, v1, v2, v3 in triangles:
            f.write(struct.pack("<fff", *n))
            f.write(struct.pack("<fff", *v1))
            f.write(struct.pack("<fff", *v2))
            f.write(struct.pack("<fff", *v3))
            f.write(struct.pack("<H", 0))
    return path
