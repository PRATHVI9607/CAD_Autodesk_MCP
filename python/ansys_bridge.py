"""
ansys_bridge.py — ANSYS FEA Simulation Bridge for cad-mcp.

Uses PyANSYS (ansys-mapdl-core) to run structural, thermal, and
modal finite element analyses on models exported by CadQuery.

Called from cadquery_server.py via handle_ansys_simulate().

Requirements:
    pip install ansys-mapdl-core ansys-mapdl-reader

ANSYS Mechanical (MAPDL) must be installed and licensed.
Set MAPDL_EXEC environment variable to the path of MAPDL executable.
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any

log = logging.getLogger("cadquery_server.ansys_bridge")

# ── Material presets (E in GPa, density in kg/m³, Poisson ratio) ──────────
MATERIAL_PRESETS: dict[str, dict[str, float]] = {
    "steel": {
        "youngs_modulus_gpa": 200.0,
        "poisson_ratio": 0.30,
        "density_kg_m3": 7850.0,
        "yield_strength_mpa": 250.0,
    },
    "aluminum": {
        "youngs_modulus_gpa": 69.0,
        "poisson_ratio": 0.33,
        "density_kg_m3": 2700.0,
        "yield_strength_mpa": 270.0,
    },
    "stainless_steel": {
        "youngs_modulus_gpa": 193.0,
        "poisson_ratio": 0.29,
        "density_kg_m3": 8000.0,
        "yield_strength_mpa": 515.0,
    },
    "titanium": {
        "youngs_modulus_gpa": 116.0,
        "poisson_ratio": 0.32,
        "density_kg_m3": 4430.0,
        "yield_strength_mpa": 830.0,
    },
    "pla": {
        "youngs_modulus_gpa": 3.5,
        "poisson_ratio": 0.36,
        "density_kg_m3": 1240.0,
        "yield_strength_mpa": 50.0,
    },
    "nylon": {
        "youngs_modulus_gpa": 3.0,
        "poisson_ratio": 0.39,
        "density_kg_m3": 1150.0,
        "yield_strength_mpa": 55.0,
    },
    "abs": {
        "youngs_modulus_gpa": 2.3,
        "poisson_ratio": 0.35,
        "density_kg_m3": 1050.0,
        "yield_strength_mpa": 40.0,
    },
}

SUPPORTED_ANALYSIS = ["structural", "modal", "thermal"]


def run_simulation(
    step_file: str,
    analysis_type: str,
    material: str | dict[str, float],
    boundary_conditions: list[dict[str, Any]],
    loads: list[dict[str, Any]],
    output_dir: str,
    output_name: str,
    *,
    mesh_size_mm: float = 5.0,
) -> dict[str, Any]:
    """
    Run a finite element analysis using ANSYS MAPDL (PyMAPDL).

    Parameters
    ----------
    step_file       Absolute path to a STEP file exported by CadQuery.
    analysis_type   One of 'structural', 'modal', 'thermal'.
    material        Material preset name (string) OR dict with keys:
                    youngs_modulus_gpa, poisson_ratio, density_kg_m3,
                    yield_strength_mpa.
    boundary_conditions  List of BC dicts, e.g.:
                    [{"type": "fixed", "face": "bottom"},
                     {"type": "symmetry", "face": "left"}]
    loads           List of load dicts, e.g.:
                    [{"type": "pressure", "face": "top", "value_mpa": 1.0},
                     {"type": "force",    "face": "top", "value_n": 500}]
    output_dir      Directory where result files are saved.
    output_name     Stem for result file names.
    mesh_size_mm    Global mesh element size.

    Returns
    -------
    dict with simulation results.
    """
    # Resolve material properties
    mat_props = _resolve_material(material)

    try:
        from ansys.mapdl.core import launch_mapdl  # type: ignore[import-untyped]
    except ImportError:
        return _fallback_result(
            analysis_type=analysis_type,
            reason="ansys-mapdl-core not installed. Run: pip install ansys-mapdl-core",
            mat_props=mat_props,
        )

    mapdl_exec = os.environ.get("MAPDL_EXEC", "")
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        mapdl = launch_mapdl(
            exec_file=mapdl_exec if mapdl_exec else None,
            run_location=str(out_dir),
            jobname=output_name,
            override=True,
        )
    except Exception as exc:
        return _fallback_result(
            analysis_type=analysis_type,
            reason=f"Could not launch ANSYS MAPDL: {exc}",
            mat_props=mat_props,
        )

    try:
        result = _run_mapdl(
            mapdl=mapdl,
            step_file=step_file,
            analysis_type=analysis_type,
            mat_props=mat_props,
            boundary_conditions=boundary_conditions,
            loads=loads,
            mesh_size_mm=mesh_size_mm,
            output_name=output_name,
            out_dir=out_dir,
        )
    finally:
        mapdl.exit()

    return result


# ---------------------------------------------------------------------------
# Internal MAPDL execution
# ---------------------------------------------------------------------------

def _resolve_material(material: str | dict[str, float]) -> dict[str, float]:
    if isinstance(material, str):
        key = material.lower().replace(" ", "_")
        if key in MATERIAL_PRESETS:
            return MATERIAL_PRESETS[key]
        log.warning("Unknown material '%s', defaulting to steel.", material)
        return MATERIAL_PRESETS["steel"]
    return material


def _run_mapdl(
    mapdl: Any,
    step_file: str,
    analysis_type: str,
    mat_props: dict[str, float],
    boundary_conditions: list[dict[str, Any]],
    loads: list[dict[str, Any]],
    mesh_size_mm: float,
    output_name: str,
    out_dir: Path,
) -> dict[str, Any]:
    """Core PyMAPDL commands to set up and solve the FEA."""

    E  = mat_props["youngs_modulus_gpa"] * 1e9   # Pa
    nu = mat_props["poisson_ratio"]
    rho = mat_props["density_kg_m3"]               # kg/m³
    ys_mpa = mat_props.get("yield_strength_mpa", 250.0)

    mapdl.clear()
    mapdl.prep7()

    # ── Import STEP geometry ──────────────────────────────────────────────
    mapdl.aux15()
    mapdl.ioptn("IGES", "STAT", "DEFA")
    mapdl.igesin(step_file)
    mapdl.prep7()

    # ── Material ──────────────────────────────────────────────────────────
    mapdl.mp("EX",  1, E)
    mapdl.mp("PRXY", 1, nu)
    mapdl.mp("DENS", 1, rho)

    # ── Element type & mesh ───────────────────────────────────────────────
    if analysis_type == "thermal":
        mapdl.et(1, "SOLID90")          # 20-node thermal brick
    else:
        mapdl.et(1, "SOLID186")         # 20-node structural brick
    mapdl.esize(mesh_size_mm * 1e-3)    # convert mm → m
    mapdl.vmesh("ALL")
    mapdl.allsel()

    # ── Analysis type ─────────────────────────────────────────────────────
    if analysis_type == "structural":
        mapdl.antype("STATIC")
    elif analysis_type == "modal":
        mapdl.antype("MODAL")
        mapdl.modopt("LANB", 10)        # Lanczos, 10 modes
        mapdl.mxpand(10)
    elif analysis_type == "thermal":
        mapdl.antype("STATIC")

    # ── Boundary conditions ───────────────────────────────────────────────
    for bc in boundary_conditions:
        bc_type = bc.get("type", "fixed")
        face    = bc.get("face", "bottom")
        _apply_bc(mapdl, bc_type, face, analysis_type)

    # ── Loads ──────────────────────────────────────────────────────────────
    for ld in loads:
        _apply_load(mapdl, ld, analysis_type)

    # ── Solve ──────────────────────────────────────────────────────────────
    mapdl.allsel()
    mapdl.solve()
    mapdl.finish()

    # ── Extract results ────────────────────────────────────────────────────
    return _extract_results(
        mapdl=mapdl,
        analysis_type=analysis_type,
        ys_mpa=ys_mpa,
        output_name=output_name,
        out_dir=out_dir,
    )


def _apply_bc(mapdl: Any, bc_type: str, face: str, analysis_type: str) -> None:
    """Apply a boundary condition. Uses face label or volume selection."""
    face_map = {
        "bottom": ("VOLU", "Z", "min"),
        "top":    ("VOLU", "Z", "max"),
        "left":   ("VOLU", "X", "min"),
        "right":  ("VOLU", "X", "max"),
        "front":  ("VOLU", "Y", "min"),
        "back":   ("VOLU", "Y", "max"),
    }
    if face in face_map:
        _select_face_nodes(mapdl, face_map[face])

    if bc_type == "fixed":
        mapdl.d("ALL", "ALL", 0)
    elif bc_type == "symmetry":
        axis = face_map.get(face, ("VOLU", "X", "min"))[1]
        mapdl.d("ALL", f"U{axis}", 0)
    elif bc_type == "temp" and analysis_type == "thermal":
        mapdl.d("ALL", "TEMP", float(face_map.get("value", 20)))

    mapdl.allsel()


def _apply_load(mapdl: Any, ld: dict[str, Any], analysis_type: str) -> None:
    """Apply a force, pressure, or temperature load."""
    ld_type = ld.get("type", "force")
    face    = ld.get("face", "top")

    face_map = {
        "bottom": ("VOLU", "Z", "min"),
        "top":    ("VOLU", "Z", "max"),
        "left":   ("VOLU", "X", "min"),
        "right":  ("VOLU", "X", "max"),
    }
    if face in face_map:
        _select_face_nodes(mapdl, face_map[face])

    if ld_type == "pressure":
        value_pa = float(ld.get("value_mpa", 1.0)) * 1e6
        mapdl.sf("ALL", "PRES", value_pa)
    elif ld_type == "force":
        value_n = float(ld.get("value_n", 1000.0))
        mapdl.f("ALL", "FZ", -value_n / max(mapdl.mesh.n_node, 1))
    elif ld_type == "temperature" and analysis_type == "thermal":
        mapdl.bf("ALL", "TEMP", float(ld.get("value_c", 100.0)))

    mapdl.allsel()


def _select_face_nodes(mapdl: Any, spec: tuple[str, str, str]) -> None:
    """Select nodes on a bounding-box face (min or max in given axis)."""
    _, axis, minmax = spec
    bounds = mapdl.mesh.nodes
    if bounds is None or len(bounds) == 0:
        return
    ax_idx = {"X": 0, "Y": 1, "Z": 2}[axis]
    val = bounds[:, ax_idx].min() if minmax == "min" else bounds[:, ax_idx].max()
    tol = abs(val) * 1e-3 + 1e-6
    mapdl.nsel("S", "LOC", axis, val - tol, val + tol)


def _extract_results(
    mapdl: Any,
    analysis_type: str,
    ys_mpa: float,
    output_name: str,
    out_dir: Path,
) -> dict[str, Any]:
    """Read result values from MAPDL and return structured output."""
    mapdl.post1()
    mapdl.set(1)

    result: dict[str, Any] = {
        "analysis_type": analysis_type,
        "material_yield_strength_mpa": ys_mpa,
    }

    if analysis_type == "structural":
        # von Mises stress
        mapdl.plnsol("S", "EQV")
        vm_stress = mapdl.get("VMSMAX", "PLNSOL", 0, "MAX")
        # Displacement
        mapdl.plnsol("U", "SUM")
        max_disp = mapdl.get("UMAX", "PLNSOL", 0, "MAX")

        max_stress_mpa = float(vm_stress) / 1e6
        max_disp_mm    = float(max_disp) * 1000.0
        safety_factor  = ys_mpa / max_stress_mpa if max_stress_mpa > 0 else float("inf")

        result.update({
            "max_von_mises_stress_mpa": round(max_stress_mpa, 4),
            "max_deformation_mm": round(max_disp_mm, 6),
            "safety_factor": round(safety_factor, 3),
            "status": "PASS" if safety_factor >= 1.5 else "WARN" if safety_factor >= 1.0 else "FAIL",
        })

    elif analysis_type == "modal":
        frequencies: list[float] = []
        for mode_n in range(1, 11):
            try:
                mapdl.set(1, mode_n)
                freq = mapdl.get("FREQ", "ACTIVE", 0, "FREQ")
                frequencies.append(round(float(freq), 4))
            except Exception:
                break
        result.update({
            "natural_frequencies_hz": frequencies,
            "mode_count": len(frequencies),
        })

    elif analysis_type == "thermal":
        mapdl.plnsol("TEMP")
        temp_max = mapdl.get("TMAX", "PLNSOL", 0, "MAX")
        temp_min = mapdl.get("TMIN", "PLNSOL", 0, "MIN")
        mapdl.plnsol("TF", "SUM")
        heat_flux = mapdl.get("HFMAX", "PLNSOL", 0, "MAX")
        result.update({
            "max_temperature_c": round(float(temp_max), 4),
            "min_temperature_c": round(float(temp_min), 4),
            "max_heat_flux_w_m2": round(float(heat_flux), 4),
        })

    # Export result file path
    rst_path = out_dir / f"{output_name}.rst"
    result["result_file"] = str(rst_path) if rst_path.exists() else None

    return result


def _fallback_result(
    analysis_type: str,
    reason: str,
    mat_props: dict[str, float],
) -> dict[str, Any]:
    """Structured error response when ANSYS is not available."""
    log.warning("ANSYS not available: %s", reason)
    return {
        "analysis_type": analysis_type,
        "ansys_available": False,
        "error": reason,
        "material_resolved": mat_props,
        "hint": (
            "To run real FEA, install ANSYS MAPDL and run: "
            "pip install ansys-mapdl-core\n"
            "Set MAPDL_EXEC env var to the path of MAPDL executable."
        ),
        "dry_run": True,
    }


# ---------------------------------------------------------------------------
# Available materials listing
# ---------------------------------------------------------------------------

def list_materials() -> dict[str, Any]:
    return {
        "materials": [
            {
                "name": name,
                **props,
            }
            for name, props in MATERIAL_PRESETS.items()
        ],
        "count": len(MATERIAL_PRESETS),
    }
