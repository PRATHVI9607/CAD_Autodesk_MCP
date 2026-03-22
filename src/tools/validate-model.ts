/**
 * validate-model.ts — cad_validate_model tool implementation.
 *
 * Checks a model for 3D printability issues: watertight geometry,
 * minimum wall thickness, overhangs, non-manifold edges.
 */

import { bridge } from "../bridge/cadquery-bridge.js";
import { ValidateModelSchema, toolOk, toolErr, type ToolResult } from "../types/cad-types.js";

/**
 * cad_validate_model
 *
 * Runs a suite of 3D printability checks on the model:
 * - Watertight (no open edges)
 * - Consistent face winding
 * - Non-manifold edge detection
 * - Degenerate face detection
 * - Thin-wall warning
 *
 * Returns is_valid (bool) and a list of human-readable issues.
 */
export async function validateModel(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = ValidateModelSchema.safeParse(rawInput);
  if (!parsed.success) {
    return toolErr(
      `Invalid parameters: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      "INVALID_PARAMS"
    );
  }

  const input = parsed.data;

  try {
    const result = await bridge.call("validate_model", {
      name: input.name,
      min_wall_thickness: input.min_wall_thickness,
    });
    return toolOk(result);
  } catch (err) {
    return toolErr(String(err instanceof Error ? err.message : err), "VALIDATE_FAILED");
  }
}
