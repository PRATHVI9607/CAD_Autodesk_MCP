"""
tests/test_cadquery_server.py — Unit tests for the JSON-RPC dispatcher.

Tests the dispatch() function without requiring CadQuery or trimesh installed.
"""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

# We patch cadquery and trimesh so these tests run without the heavy deps
import cadquery_server as srv  # type: ignore[import-not-found]


class TestDispatch:
    """Tests for the JSON-RPC dispatcher layer."""

    def test_ping(self) -> None:
        resp = srv.dispatch(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {}}))
        assert resp["id"] == 1
        assert "result" in resp
        assert resp["result"]["pong"] is True

    def test_method_not_found(self) -> None:
        resp = srv.dispatch(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "does_not_exist"}))
        assert "error" in resp
        assert resp["error"]["code"] == -32601

    def test_parse_error(self) -> None:
        resp = srv.dispatch("{ bad json }")
        assert "error" in resp
        assert resp["error"]["code"] == -32700

    def test_missing_method(self) -> None:
        resp = srv.dispatch(json.dumps({"jsonrpc": "2.0", "id": 3}))
        assert "error" in resp
        assert resp["error"]["code"] in (-32600, -32601)


class TestSafeOutputPath:
    def test_valid_name(self, tmp_path: Path) -> None:
        path = srv._safe_output_path("my_model", tmp_path, ".stl")
        assert path == (tmp_path / "my_model.stl").resolve()

    def test_rejects_traversal(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="Invalid name"):
            srv._safe_output_path("../etc/passwd", tmp_path, ".stl")

    def test_rejects_empty(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="Invalid name"):
            srv._safe_output_path("", tmp_path, ".stl")

    def test_rejects_special_chars(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="Invalid name"):
            srv._safe_output_path("model; rm -rf /", tmp_path, ".stl")


class TestValidateDimension:
    def test_positive(self) -> None:
        assert srv._validate_dimension(10.0, "width") == 10.0

    def test_zero_raises(self) -> None:
        with pytest.raises(ValueError, match="must be > 0"):
            srv._validate_dimension(0.0, "width")

    def test_negative_raises(self) -> None:
        with pytest.raises(ValueError, match="must be > 0"):
            srv._validate_dimension(-5.0, "depth")

    def test_too_large_raises(self) -> None:
        with pytest.raises(ValueError, match="exceeds maximum"):
            srv._validate_dimension(200_000.0, "width")


class TestModelRegistry:
    def teardown_method(self) -> None:
        srv._models.clear()

    def test_get_model_missing(self) -> None:
        with pytest.raises(KeyError, match="not found"):
            srv._get_model("nonexistent")

    def test_get_model_after_set(self) -> None:
        srv._models["test"] = "some_shape"
        assert srv._get_model("test") == "some_shape"
