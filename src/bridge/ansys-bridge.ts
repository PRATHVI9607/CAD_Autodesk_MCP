/**
 * ansys-bridge.ts — TypeScript bridge for ANSYS FEA simulations.
 *
 * Delegates ANSYS simulation requests to the Python ansys_bridge module
 * via the CadQuery JSON-RPC subprocess.
 *
 * The Python subprocess must have ansys-mapdl-core installed and
 * ANSYS MAPDL licensed & accessible. Without it, a dry-run fallback
 * response is returned gracefully.
 */

import { bridge } from "./cadquery-bridge.js";

const ANSYS_TIMEOUT_MS = parseInt(
  process.env["CAD_MCP_ANSYS_TIMEOUT_MS"] ?? "300000",  // 5 minutes default
  10
);

export type AnalysisType = "structural" | "modal" | "thermal";

export interface BoundaryCondition {
  type: "fixed" | "symmetry" | "temp";
  face: "bottom" | "top" | "left" | "right" | "front" | "back";
  value?: number;
}

export interface Load {
  type: "pressure" | "force" | "temperature";
  face: "bottom" | "top" | "left" | "right" | "front" | "back";
  value_mpa?: number;
  value_n?: number;
  value_c?: number;
}

export interface AnsysSimulateParams {
  name: string;
  analysis_type: AnalysisType;
  material: string | Record<string, number>;
  boundary_conditions?: BoundaryCondition[];
  loads?: Load[];
  mesh_size_mm?: number;
  output_name?: string;
}

/**
 * Run an ANSYS FEA simulation on an in-memory model.
 * The model is first exported to STEP, then handed to MAPDL.
 */
export async function runAnsysSimulation(
  params: AnsysSimulateParams
): Promise<Record<string, unknown>> {
  return bridge.call(
    "ansys_simulate",
    {
      name: params.name,
      analysis_type: params.analysis_type,
      material: params.material,
      boundary_conditions: params.boundary_conditions ?? [],
      loads: params.loads ?? [],
      mesh_size_mm: params.mesh_size_mm ?? 5.0,
      output_name: params.output_name ?? `${params.name}_${params.analysis_type}`,
    },
    ANSYS_TIMEOUT_MS
  );
}

/**
 * List all available built-in material presets.
 */
export async function listAnsysMaterials(): Promise<Record<string, unknown>> {
  return bridge.call("ansys_list_materials", {});
}
