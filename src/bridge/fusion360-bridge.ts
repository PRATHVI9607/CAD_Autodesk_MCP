/**
 * fusion360-bridge.ts — Autodesk Platform Services (APS) TypeScript bridge.
 *
 * Delegates Fusion 360 / APS operations to the Python fusion360_bridge module
 * via the CadQuery JSON-RPC subprocess.
 *
 * Required env vars (set in .mcp.json or shell):
 *   APS_CLIENT_ID      — Client ID from aps.autodesk.com
 *   APS_CLIENT_SECRET  — Client Secret from aps.autodesk.com
 *   APS_BUCKET_KEY     — OSS bucket name (e.g. "cad-mcp-models")
 */

import { bridge } from "./cadquery-bridge.js";

const F360_TIMEOUT_MS = parseInt(
  process.env["CAD_MCP_F360_TIMEOUT_MS"] ?? "180000",  // 3 minutes
  10
);

/**
 * Upload a model to Autodesk OSS and get back its base64 URN.
 */
export async function uploadToAPS(params: {
  name: string;
  format?: string;
}): Promise<Record<string, unknown>> {
  return bridge.call("fusion360_upload", params, F360_TIMEOUT_MS);
}

/**
 * Translate an uploaded model to SVF2/OBJ and return the manifest.
 */
export async function translateModel(params: {
  name: string;
  output_format?: string;
}): Promise<Record<string, unknown>> {
  return bridge.call("fusion360_translate", params, F360_TIMEOUT_MS);
}

/**
 * Get a rendered thumbnail PNG for the model (via APS).
 */
export async function getThumbnail(params: {
  name: string;
  width?: number;
  height?: number;
  output_name?: string;
}): Promise<Record<string, unknown>> {
  return bridge.call("fusion360_thumbnail", params, F360_TIMEOUT_MS);
}

/**
 * Get model properties (mass, materials, bounding box) from APS.
 */
export async function getModelProperties(params: {
  name: string;
}): Promise<Record<string, unknown>> {
  return bridge.call("fusion360_properties", params, F360_TIMEOUT_MS);
}

/**
 * Check APS credentials and bucket configuration.
 */
export async function checkCredentials(): Promise<Record<string, unknown>> {
  return bridge.call("fusion360_check_credentials", {});
}
