/**
 * fusion360-tools.ts — Autodesk Fusion 360 / APS MCP tool implementations.
 *
 * Replaces the former ANSYS simulation tools.
 *
 * Tools:
 *   cad_fusion360_upload      — Upload model to Autodesk hub (OSS), get URN
 *   cad_fusion360_render      — Get rendered thumbnail PNG via APS
 *   cad_fusion360_translate   — Translate to SVF2 (Forge Viewer) or OBJ
 *   cad_fusion360_properties  — Get mass, materials, bounding box from APS
 *   cad_fusion360_credentials — Check APS API credentials
 */

import { bridge } from "../bridge/cadquery-bridge.js";
import { toolOk, toolErr, type ToolResult } from "../types/cad-types.js";

// ---------------------------------------------------------------------------
// Tool handler helpers
// ---------------------------------------------------------------------------

async function callF360(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 180_000
): Promise<ToolResult> {
  try {
    const result = await bridge.call(method, params, timeoutMs);
    return toolOk(result);
  } catch (err) {
    return toolErr(
      String(err instanceof Error ? err.message : err),
      "FUSION360_ERROR"
    );
  }
}

// ---------------------------------------------------------------------------
// Tool 5a: cad_fusion360_upload
// ---------------------------------------------------------------------------

/**
 * Upload the model to Autodesk Platform Services (OSS) cloud storage.
 * Returns: urn, object_name, viewer_url (Forge Viewer link)
 */
export async function fusion360Upload(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const name = rawInput["name"];
  if (typeof name !== "string" || !name) {
    return toolErr("Missing required parameter: 'name'", "INVALID_PARAMS");
  }
  return callF360("fusion360_upload", {
    name,
    format: rawInput["format"] ?? "STEP",
  });
}

// ---------------------------------------------------------------------------
// Tool 5b: cad_fusion360_render
// ---------------------------------------------------------------------------

/**
 * Get a rendered thumbnail PNG of the model via Autodesk APS.
 * Uploads → translates → downloads thumbnail.
 * Returns: path to PNG file, viewer_url
 */
export async function fusion360Render(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const name = rawInput["name"];
  if (typeof name !== "string" || !name) {
    return toolErr("Missing required parameter: 'name'", "INVALID_PARAMS");
  }
  return callF360(
    "fusion360_thumbnail",
    {
      name,
      width:       rawInput["width"]       ?? 800,
      height:      rawInput["height"]      ?? 600,
      output_name: rawInput["output_name"] ?? `${name}_f360_render`,
    },
    180_000
  );
}

// ---------------------------------------------------------------------------
// Tool 5c: cad_fusion360_translate
// ---------------------------------------------------------------------------

/**
 * Translate a CadQuery model to Forge Viewer (SVF2) or download as OBJ.
 * Returns the manifest and a viewer URL you can open in a browser.
 */
export async function fusion360Translate(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const name = rawInput["name"];
  if (typeof name !== "string" || !name) {
    return toolErr("Missing required parameter: 'name'", "INVALID_PARAMS");
  }
  return callF360("fusion360_translate", {
    name,
    output_format: rawInput["output_format"] ?? "svf2",
  });
}

// ---------------------------------------------------------------------------
// Tool 5d: cad_fusion360_properties
// ---------------------------------------------------------------------------

/**
 * Retrieve model properties (mass, materials, components, bounding box) from
 * Autodesk Platform Services after translating the model.
 */
export async function fusion360Properties(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const name = rawInput["name"];
  if (typeof name !== "string" || !name) {
    return toolErr("Missing required parameter: 'name'", "INVALID_PARAMS");
  }
  return callF360("fusion360_properties", { name });
}

// ---------------------------------------------------------------------------
// Tool 5e: cad_fusion360_credentials
// ---------------------------------------------------------------------------

/**
 * Check whether Autodesk Platform Services credentials (APS_CLIENT_ID,
 * APS_CLIENT_SECRET) are correctly configured.
 * Returns: configured: true/false, instructions if not set.
 */
export async function fusion360Credentials(
  _rawInput: Record<string, unknown>
): Promise<ToolResult> {
  return callF360("fusion360_check_credentials", {});
}
