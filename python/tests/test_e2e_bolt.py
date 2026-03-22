"""
tests/test_e2e_bolt.py — End-to-end test: M6 bolt workflow.

This test simulates the full pipeline that Claude would run:
  1. cad_create_model  → M6 bolt (cylinder)
  2. cad_export_model  → STL file
  3. cad_query_properties → volume, surface area, bounding box
  4. cad_apply_operation → fillet edges
  5. cad_validate_model → printability check

Requires: CadQuery + trimesh installed.
Run with: cd python && pytest tests/test_e2e_bolt.py -v -s
"""

import json
import sys
import subprocess
import threading
import time
import os
from pathlib import Path

import pytest

# ------------------------------------------------------------------
# Helpers — talk to cadquery_server.py via subprocess
# ------------------------------------------------------------------

PYTHON_SCRIPT = Path(__file__).parent.parent / "cadquery_server.py"
TIMEOUT = 120  # CadQuery can be slow on first run


class ServerProcess:
    """Wraps cadquery_server.py as a test fixture subprocess."""

    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None  # type: ignore[type-arg]
        self._id = 1
        self._lock = threading.Lock()

    def start(self) -> None:
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        self.proc = subprocess.Popen(
            [sys.executable, str(PYTHON_SCRIPT)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            cwd=str(PYTHON_SCRIPT.parent.parent),
        )
        # Wait for server_ready notification
        assert self.proc is not None, "Popen failed to start"
        assert self.proc.stdout is not None, "stdout pipe not available"
        assert self.proc.stderr is not None, "stderr pipe not available"
        for _ in range(60):
            line = self.proc.stdout.readline().decode().strip()
            if not line:
                time.sleep(0.5)
                continue
            msg = json.loads(line)
            if msg.get("method") == "server_ready":
                return
        raise RuntimeError("cadquery_server.py did not send server_ready within timeout")

    def stop(self) -> None:
        if self.proc:
            self.proc.stdin.close()  # type: ignore[union-attr]
            self.proc.wait(timeout=5)

    def call(self, method: str, params: dict) -> dict:  # type: ignore[type-arg]
        with self._lock:
            rpc_id = self._id
            self._id += 1
        request = json.dumps({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": method,
            "params": params,
        }) + "\n"
        assert self.proc is not None, "Server not started"
        assert self.proc.stdin is not None, "stdin pipe not available"
        assert self.proc.stdout is not None, "stdout pipe not available"
        self.proc.stdin.write(request.encode())
        self.proc.stdin.flush()
        while True:
            line = self.proc.stdout.readline().decode().strip()
            if not line:
                continue
            resp = json.loads(line)
            if resp.get("id") == rpc_id:
                return resp
            # skip notifications (e.g. progress)


@pytest.fixture(scope="module")
def server() -> "ServerProcess":  # type: ignore[type-arg]
    pytest.importorskip("cadquery", reason="CadQuery not installed — skipping E2E tests")
    s = ServerProcess()
    s.start()
    yield s
    s.stop()


# ------------------------------------------------------------------
# E2E: M6 Bolt workflow
# ------------------------------------------------------------------

class TestBoltM6Workflow:
    def test_01_create_bolt_shank(self, server: "ServerProcess") -> None:
        """Create the bolt shank as a cylinder."""
        resp = server.call("create_model", {
            "output_name": "bolt_shank",
            "base_shape": "cylinder",
            "parameters": {"radius": 3, "height": 25},
            "units": "mm",
        })
        assert "error" not in resp, f"Unexpected error: {resp.get('error')}"
        result = resp["result"]
        assert result["name"] == "bolt_shank"
        assert result["shape"] == "cylinder"

    def test_02_create_bolt_head(self, server: "ServerProcess") -> None:
        """Create the bolt head as a squat cylinder."""
        resp = server.call("create_model", {
            "output_name": "bolt_head",
            "base_shape": "cylinder",
            "parameters": {"radius": 5, "height": 4},
            "units": "mm",
        })
        assert "error" not in resp
        assert resp["result"]["name"] == "bolt_head"

    def test_03_export_shank_to_stl(self, server: "ServerProcess") -> None:
        """Export the shank to STL and verify file was written."""
        resp = server.call("export_model", {
            "name": "bolt_shank",
            "format": "STL",
            "output_name": "bolt_shank_export",
        })
        assert "error" not in resp, f"Export failed: {resp.get('error')}"
        result = resp["result"]
        assert result["format"] == "STL"
        assert isinstance(result["path"], str)
        assert int(result.get("size_bytes", 0)) > 0, "STL file appears empty"
        assert Path(result["path"]).exists(), f"STL file not found: {result['path']}"

    def test_04_query_properties(self, server: "ServerProcess") -> None:
        """Volume of a r=3mm, h=25mm cylinder should be ≈ 706.86 mm³."""
        resp = server.call("query_properties", {"name": "bolt_shank"})
        assert "error" not in resp
        result = resp["result"]
        assert "volume_mm3" in result
        volume = float(result["volume_mm3"])
        expected = 3.14159 * 3**2 * 25  # ≈ 706.86 mm³
        assert abs(volume - expected) / expected < 0.01, (
            f"Volume {volume:.2f} deviates >1% from expected {expected:.2f}"
        )
        assert "bounding_box" in result
        assert "center_of_mass" in result

    def test_05_apply_fillet(self, server: "ServerProcess") -> None:
        """Apply a small fillet to the shank edges."""
        resp = server.call("apply_operation", {
            "name": "bolt_shank",
            "operation": "fillet",
            "output_name": "bolt_shank_filleted",
            "op_params": {"radius": 0.5},
        })
        assert "error" not in resp, f"Fillet failed: {resp.get('error')}"
        assert resp["result"]["operation"] == "fillet"

    def test_06_validate_for_printing(self, server: "ServerProcess") -> None:
        """Validate the filleted shank for 3D printing."""
        resp = server.call("validate_model", {
            "name": "bolt_shank_filleted",
            "min_wall_thickness": 1.5,
        })
        assert "error" not in resp
        result = resp["result"]
        assert "is_valid" in result
        assert "is_watertight" in result
        assert isinstance(result["issues"], list)
        # A clean solid cylinder with fillet should be valid
        assert result["is_valid"] is True, f"Validation failed: {result['issues']}"

    def test_07_export_to_step(self, server: "ServerProcess") -> None:
        """Export the filleted shank to STEP format."""
        resp = server.call("export_model", {
            "name": "bolt_shank_filleted",
            "format": "STEP",
            "output_name": "bolt_shank_filleted",
        })
        assert "error" not in resp
        result = resp["result"]
        assert result["format"] == "STEP"
        assert int(result.get("size_bytes", 0)) > 0

    def test_08_head_export_stl(self, server: "ServerProcess") -> None:
        """Export the bolt head as STL too."""
        resp = server.call("export_model", {
            "name": "bolt_head",
            "format": "STL",
            "output_name": "bolt_head_export",
        })
        assert "error" not in resp
        assert int(resp["result"].get("size_bytes", 0)) > 0


# ------------------------------------------------------------------
# Security: rejection tests
# ------------------------------------------------------------------

class TestSecurityRejects:
    def test_negative_dimension_rejected(self, server: "ServerProcess") -> None:
        resp = server.call("create_model", {
            "output_name": "bad",
            "base_shape": "box",
            "parameters": {"width": -10, "height": 5, "depth": 5},
            "units": "mm",
        })
        assert "error" in resp, "Negative dimension should have been rejected"

    def test_path_traversal_rejected(self, server: "ServerProcess") -> None:
        resp = server.call("export_model", {
            "name": "bolt_shank",
            "format": "STL",
            "output_name": "../escape",
        })
        assert "error" in resp, "Path traversal should have been rejected"

    def test_unknown_model_rejected(self, server: "ServerProcess") -> None:
        resp = server.call("query_properties", {"name": "does_not_exist_xyz"})
        assert "error" in resp


# ------------------------------------------------------------------
# Template library
# ------------------------------------------------------------------

class TestTemplateLibrary:
    def test_list_templates_returns_list(self, server: "ServerProcess") -> None:
        resp = server.call("list_templates", {})
        assert "error" not in resp
        result = resp["result"]
        assert "templates" in result
        assert isinstance(result["templates"], list)
        assert "count" in result

    def test_list_templates_mechanical(self, server: "ServerProcess") -> None:
        resp = server.call("list_templates", {"category": "mechanical"})
        assert "error" not in resp
        result = resp["result"]
        # Should find bolt_m6, nut_m6, bracket_l, gear_spur
        assert result["count"] >= 4, (
            f"Expected ≥ 4 mechanical templates, got {result['count']}: "
            f"{[t.get('id') for t in result['templates']]}"
        )

    def test_load_bolt_template(self, server: "ServerProcess") -> None:
        resp = server.call("load_template", {
            "template_id": "bolt_m6",
            "parameters": {"shank_length": 30},
            "output_name": "bolt_from_template",
        })
        assert "error" not in resp, f"Template load failed: {resp.get('error')}"
