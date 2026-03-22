/**
 * render-preview.ts — cad_render_preview tool implementation.
 *
 * Renders a PNG preview image of a model from a specified camera angle.
 * Uses trimesh + matplotlib as primary renderer; falls back to Blender
 * headless if available.
 */

import { bridge } from "../bridge/cadquery-bridge.js";
import { RenderPreviewSchema, toolOk, toolErr, type ToolResult } from "../types/cad-types.js";

/**
 * cad_render_preview
 *
 * Generates a PNG preview image of the specified model. Returns the
 * absolute path to the rendered image.
 *
 * - Primary renderer: trimesh + matplotlib (no extra install beyond requirements.txt)
 * - Optional: set CAD_MCP_USE_BLENDER=1 to use Blender headless instead.
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
    // Use longer render timeout
    const result = await bridge.render("render_preview", {
      name: input.name,
      output_name: input.output_name ?? `${input.name}_preview`,
      azimuth: input.azimuth,
      elevation: input.elevation,
      width: input.width,
      height: input.height,
    });
    return toolOk(result);
  } catch (err) {
    return toolErr(String(err instanceof Error ? err.message : err), "RENDER_FAILED");
  }
}
