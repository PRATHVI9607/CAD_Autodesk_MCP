/**
 * render-preview.ts — cad_render_preview tool implementation.
 *
 * Renders a PNG preview of a model using trimesh + matplotlib.
 */

import { bridge } from "../bridge/cadquery-bridge.js";
import { RenderPreviewSchema, toolOk, toolErr, type ToolResult } from "../types/cad-types.js";

/**
 * cad_render_preview
 *
 * Renders a PNG preview of the specified model from the given camera angle.
 * Supports dark, light, and transparent background modes.
 */
export async function renderPreview(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = RenderPreviewSchema.safeParse(rawInput);
  if (!parsed.success) {
    return toolErr(
      `Invalid parameters: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      "INVALID_PARAMS"
    );
  }

  const input = parsed.data;

  try {
    const result = await bridge.render("render_preview", {
      name:        input.name,
      azimuth:     input.azimuth,
      elevation:   input.elevation,
      width:       input.width,
      height:      input.height,
      background:  input.background,
      ...(input.output_name !== undefined ? { output_name: input.output_name } : {}),
    });
    return toolOk(result);
  } catch (err) {
    return toolErr(String(err instanceof Error ? err.message : err), "RENDER_FAILED");
  }
}
