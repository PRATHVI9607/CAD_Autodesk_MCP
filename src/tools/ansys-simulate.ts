/**
 * ansys-simulate.ts — cad_ansys_simulate tool implementation.
 *
 * Runs structural, modal, or thermal finite element analysis (FEA)
 * on an in-memory CAD model using ANSYS MAPDL (via PyANSYS / PyMAPDL).
 *
 * Replaces the former Blender-based render_preview tool.
 */

import { bridge } from "../bridge/cadquery-bridge.js";
import { z } from "zod";
import { toolOk, toolErr, type ToolResult } from "../types/cad-types.js";

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const FaceEnum = z.enum(["bottom", "top", "left", "right", "front", "back"]);

const BoundaryConditionSchema = z.object({
  type:  z.enum(["fixed", "symmetry", "temp"]).describe("Constraint type"),
  face:  FaceEnum.describe("Face to apply the BC (bottom/top/left/right/front/back)"),
  value: z.number().optional().describe("Value (only relevant for temp BC)"),
});

const LoadSchema = z.union([
  z.object({
    type:      z.literal("pressure"),
    face:      FaceEnum,
    value_mpa: z.number().positive().describe("Pressure magnitude in MPa"),
  }),
  z.object({
    type:    z.literal("force"),
    face:    FaceEnum,
    value_n: z.number().describe("Force magnitude in Newtons"),
  }),
  z.object({
    type:    z.literal("temperature"),
    face:    FaceEnum,
    value_c: z.number().describe("Temperature in °C"),
  }),
]);

export const AnsysSimulateSchema = z.object({
  name:          z.string().min(1).max(128).regex(/^[A-Za-z0-9_\-]+$/),
  analysis_type: z.enum(["structural", "modal", "thermal"]).default("structural"),
  material:      z.union([
    z.string().describe("Material preset: steel, aluminum, stainless_steel, titanium, pla, nylon, abs"),
    z.object({
      youngs_modulus_gpa:  z.number().positive(),
      poisson_ratio:       z.number().min(0).max(0.5),
      density_kg_m3:       z.number().positive(),
      yield_strength_mpa:  z.number().positive().optional(),
    }).describe("Custom material properties"),
  ]).default("steel"),
  boundary_conditions: z.array(BoundaryConditionSchema).optional().default([
    { type: "fixed", face: "bottom" },
  ]).describe("Structural/thermal boundary conditions"),
  loads: z.array(LoadSchema).optional().default([]).describe("Applied loads"),
  mesh_size_mm: z.number().positive().default(5.0)
    .describe("Finite element mesh size in mm (smaller = finer, slower)"),
  output_name: z.string().min(1).max(128).regex(/^[A-Za-z0-9_\-]+$/).optional()
    .describe("Result file name stem (default: {name}_{analysis_type})"),
});

export type AnsysSimulateInput = z.infer<typeof AnsysSimulateSchema>;

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

/**
 * cad_ansys_simulate
 *
 * Exports the model to STEP format and runs a finite element analysis
 * using ANSYS MAPDL:
 *
 * - structural: static stress/deformation analysis → von Mises stress,
 *               max deformation, safety factor (Pass/Warn/Fail)
 * - modal:      natural frequency extraction → first N natural frequencies (Hz)
 * - thermal:    steady-state heat transfer → temperature distribution,
 *               heat flux
 *
 * Requires ANSYS MAPDL + ansys-mapdl-core (PyMAPDL).
 * Returns a dry-run fallback response if ANSYS is not available.
 */
export async function ansysSimulate(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = AnsysSimulateSchema.safeParse(rawInput);
  if (!parsed.success) {
    return toolErr(
      `Invalid parameters: ${parsed.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ")}`,
      "INVALID_PARAMS"
    );
  }

  const input = parsed.data;
  const outputName = input.output_name ?? `${input.name}_${input.analysis_type}`;

  try {
    const result = await bridge.call(
      "ansys_simulate",
      {
        name:                input.name,
        analysis_type:       input.analysis_type,
        material:            input.material,
        boundary_conditions: input.boundary_conditions,
        loads:               input.loads,
        mesh_size_mm:        input.mesh_size_mm,
        output_name:         outputName,
      },
      // FEA can take a long time — up to 5 minutes
      parseInt(process.env["CAD_MCP_ANSYS_TIMEOUT_MS"] ?? "300000", 10)
    );
    return toolOk(result);
  } catch (err) {
    return toolErr(
      String(err instanceof Error ? err.message : err),
      "ANSYS_SIMULATE_FAILED"
    );
  }
}

/**
 * cad_ansys_list_materials
 *
 * Returns all built-in ANSYS material presets with their mechanical properties.
 */
export async function ansysListMaterials(
  _rawInput: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const result = await bridge.call("ansys_list_materials", {});
    return toolOk(result);
  } catch (err) {
    return toolErr(String(err instanceof Error ? err.message : err), "ANSYS_MATERIALS_FAILED");
  }
}
