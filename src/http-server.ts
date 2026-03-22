/**
 * http-server.ts — HTTP wrapper for the cad-mcp server
 *
 * Exposes the CAD tools over HTTP so that TestSprite and other
 * external testing tools can call them without needing stdio MCP transport.
 *
 * Run: node dist/http-server.js
 * Default port: 3000 (override with PORT env var)
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createModel }     from "./tools/create-model.js";
import { exportModel }     from "./tools/export-model.js";
import { queryProperties } from "./tools/query-model.js";
import { applyOperation }  from "./tools/modify-model.js";
import { validateModel }   from "./tools/validate-model.js";
import {
  listTemplates,
  loadTemplate,
  importFile,
  sketch2d,
} from "./tools/template-library.js";
import {
  fusion360Upload,
  fusion360Render,
  fusion360Translate,
  fusion360Properties,
  fusion360Credentials,
} from "./tools/fusion360-tools.js";
import { bridge } from "./bridge/cadquery-bridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const EXPORTS_DIR = path.resolve(__dirname, "../models/exports");
const VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const TOOLS: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  cad_create_model:           createModel,
  cad_export_model:           exportModel,
  cad_query_properties:       queryProperties,
  cad_apply_operation:        applyOperation,
  cad_validate_model:         validateModel,
  cad_list_templates:         listTemplates,
  cad_load_template:          loadTemplate,
  cad_import_file:            importFile,
  cad_sketch_2d:              sketch2d,
  cad_fusion360_upload:       fusion360Upload,
  cad_fusion360_render:       fusion360Render,
  cad_fusion360_translate:    fusion360Translate,
  cad_fusion360_properties:   fusion360Properties,
  cad_fusion360_credentials:  fusion360Credentials,
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  cad_create_model:           "Create a parametric 3D model (box, cylinder, sphere, cone, torus)",
  cad_export_model:           "Export a model to STL, STEP, OBJ, GLTF, DXF, or SVG",
  cad_query_properties:       "Query volume, surface area, bounding box, and centre of mass",
  cad_apply_operation:        "Apply fillet, chamfer, extrude, boolean ops, mirror, pattern",
  cad_validate_model:         "Check a model for 3D printability issues",
  cad_list_templates:         "List templates in the mechanical/architectural/organic library",
  cad_load_template:          "Instantiate a template with custom parameters",
  cad_import_file:            "Import an existing STL/STEP/OBJ file into memory",
  cad_sketch_2d:              "Create a 2D sketch (line, arc, circle, rect) on a plane",
  cad_fusion360_upload:       "Upload model to Autodesk cloud (OSS) — returns URN + Forge Viewer URL",
  cad_fusion360_render:       "Upload + translate + download rendered PNG thumbnail via APS",
  cad_fusion360_translate:    "Translate model to SVF2 (Forge Viewer) or OBJ via APS",
  cad_fusion360_properties:   "Get mass, materials, bounding box from Autodesk APS",
  cad_fusion360_credentials:  "Check APS_CLIENT_ID / APS_CLIENT_SECRET configuration",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
    req.on("end", () => {
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type" });
    res.end();
    return;
  }

  // ── GET /health ───────────────────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/health") {
    json(res, 200, { status: "ok", version: VERSION, timestamp: new Date().toISOString() });
    return;
  }

  // ── GET /tools ────────────────────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/tools") {
    const tools = Object.entries(TOOL_DESCRIPTIONS).map(([name, description]) => ({
      name,
      description,
    }));
    json(res, 200, { tools, count: tools.length });
    return;
  }

  // ── GET /exports ──────────────────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/exports") {
    try {
      const files = fs.existsSync(EXPORTS_DIR)
        ? fs.readdirSync(EXPORTS_DIR)
            .filter((f) => !f.startsWith("."))
            .map((f) => {
              const stat = fs.statSync(path.join(EXPORTS_DIR, f));
              return { name: f, size_bytes: stat.size, modified: stat.mtime.toISOString() };
            })
        : [];
      json(res, 200, { files, count: files.length });
    } catch (err) {
      json(res, 500, { error: String(err) });
    }
    return;
  }

  // ── POST /call ────────────────────────────────────────────────────────────
  if (req.method === "POST" && pathname === "/call") {
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { success: false, error: "Invalid JSON body" });
      return;
    }

    const { tool, params } = body as { tool?: string; params?: Record<string, unknown> };

    if (typeof tool !== "string" || !tool) {
      json(res, 400, { success: false, error: "Missing required field: 'tool'" });
      return;
    }

    const handler = TOOLS[tool];
    if (!handler) {
      json(res, 404, {
        success: false,
        error: `Unknown tool '${tool}'. Available: ${Object.keys(TOOLS).join(", ")}`,
      });
      return;
    }

    try {
      const result = await handler(params ?? {});
      json(res, 200, result);
    } catch (err) {
      json(res, 500, {
        success: false,
        error: String(err instanceof Error ? err.message : err),
        code: "TOOL_ERROR",
      });
    }
    return;
  }

  // 404 fallback
  json(res, 404, { error: `Not found: ${req.method} ${pathname}` });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handler(req, res).catch((err: unknown) => {
    process.stderr.write(`Unhandled error: ${err}\n`);
    if (!res.headersSent) {
      json(res, 500, { success: false, error: "Internal server error" });
    }
  });
});

const shutdown = async () => {
  await bridge.stop();
  server.close();
  process.exit(0);
};

process.on("SIGINT",  () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });

server.listen(PORT, () => {
  process.stderr.write(`cad-mcp HTTP server listening on http://localhost:${PORT}\n`);
  process.stderr.write(`  GET  /health  — health check\n`);
  process.stderr.write(`  GET  /tools   — list all tools\n`);
  process.stderr.write(`  GET  /exports — list exported files\n`);
  process.stderr.write(`  POST /call    — { tool, params } → result\n`);
});
