/**
 * export-model.ts — cad_export_model tool implementation.
 *
 * Exports an in-memory model to a standard file format.
 */

import { bridge } from "../bridge/cadquery-bridge.js";
import { ExportModelSchema, toolOk, toolErr, type ToolResult } from "../types/cad-types.js";

/**
 * cad_export_model
 *
 * Exports a previously created model to STL, STEP, OBJ, GLTF, DXF, or SVG.
 * Returns the path to the exported file.
 */
export async function exportModel(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = ExportModelSchema.safeParse(rawInput);
  if (!parsed.success) {
    return toolErr(
      `Invalid parameters: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      "INVALID_PARAMS"
    );
  }

  const input = parsed.data;

  try {
    const result = await bridge.call("export_model", {
      name: input.name,
      format: input.format,
      output_name: input.output_name ?? input.name,
    });
    return toolOk(result);
  } catch (err) {
    return toolErr(String(err instanceof Error ? err.message : err), "EXPORT_FAILED");
  }
}
