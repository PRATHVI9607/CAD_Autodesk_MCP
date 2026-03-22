/**
 * query-model.ts — cad_query_properties tool implementation.
 *
 * Returns geometric properties of a model: volume, surface area,
 * bounding box, centre of mass, and optionally mass.
 */

import { bridge } from "../bridge/cadquery-bridge.js";
import { QueryPropertiesSchema, toolOk, toolErr, type ToolResult } from "../types/cad-types.js";

/**
 * cad_query_properties
 *
 * Computes and returns the geometric properties of a model using
 * OpenCASCADE's mass property algorithms (via CadQuery).
 */
export async function queryProperties(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = QueryPropertiesSchema.safeParse(rawInput);
  if (!parsed.success) {
    return toolErr(
      `Invalid parameters: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      "INVALID_PARAMS"
    );
  }

  const input = parsed.data;

  try {
    const result = await bridge.call("query_properties", {
      name: input.name,
      ...(input.density !== undefined ? { density: input.density } : {}),
    });
    return toolOk(result);
  } catch (err) {
    return toolErr(String(err instanceof Error ? err.message : err), "QUERY_FAILED");
  }
}
