/**
 * create-model.ts — cad_create_model tool implementation.
 *
 * Creates a parametric 3D model from a natural language description
 * and/or structured dimension parameters.
 */

import { bridge } from "../bridge/cadquery-bridge.js";
import { CreateModelSchema, toolOk, toolErr, type ToolResult } from "../types/cad-types.js";

/**
 * cad_create_model
 *
 * Generates a parametric 3D model and registers it in the in-memory
 * model registry on the Python side. The model can then be exported,
 * queried, validated, or rendered by other tools.
 */
export async function createModel(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = CreateModelSchema.safeParse(rawInput);
  if (!parsed.success) {
    return toolErr(
      `Invalid parameters: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      "INVALID_PARAMS"
    );
  }

  const input = parsed.data;

  try {
    const result = await bridge.call("create_model", {
      output_name: input.output_name,
      base_shape: input.base_shape,
      parameters: input.parameters ?? {},
      description: input.description ?? "",
      units: input.units,
      material: input.material ?? "",
    });
    return toolOk(result);
  } catch (err) {
    return toolErr(String(err instanceof Error ? err.message : err), "CREATE_FAILED");
  }
}
