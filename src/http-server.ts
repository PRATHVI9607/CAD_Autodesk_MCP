/**
 * http-server.ts — HTTP wrapper for cad-mcp (testing / dev use)
 * Run: npm run start:http   →  http://localhost:3000
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
import { bridge } from "./bridge/cadquery-bridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const EXPORTS_DIR = path.resolve(__dirname, "../models/exports");
const VERSION = "0.1.0";

const TOOLS: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  cad_create_model:     createModel,
  cad_export_model:     exportModel,
  cad_query_properties: queryProperties,
  cad_apply_operation:  applyOperation,
  cad_validate_model:   validateModel,
  cad_list_templates:   listTemplates,
  cad_load_template:    loadTemplate,
  cad_import_file:      importFile,
  cad_sketch_2d:        sketch2d,
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  cad_create_model:     "Create a parametric 3D model (box, cylinder, sphere, cone, torus)",
  cad_export_model:     "Export a model to STL, STEP, OBJ, GLTF, DXF, or SVG",
  cad_query_properties: "Query volume, surface area, bounding box, and centre of mass",
  cad_apply_operation:  "Apply fillet, chamfer, shell, extrude, boolean ops, mirror, pattern",
  cad_validate_model:   "Check a model for 3D printability issues",
  cad_list_templates:   "List templates in the mechanical/architectural/organic library",
  cad_load_template:    "Instantiate a template with custom parameters",
  cad_import_file:      "Import an existing STL/STEP/OBJ file into memory",
  cad_sketch_2d:        "Create a 2D sketch (line, arc, circle, rect) on a plane",
};

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

async function handler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type" });
    res.end(); return;
  }

  if (req.method === "GET" && pathname === "/health") {
    json(res, 200, { status: "ok", version: VERSION, tools: Object.keys(TOOLS).length, timestamp: new Date().toISOString() });
    return;
  }

  if (req.method === "GET" && pathname === "/tools") {
    const tools = Object.entries(TOOL_DESCRIPTIONS).map(([name, description]) => ({ name, description }));
    json(res, 200, { tools, count: tools.length });
    return;
  }

  if (req.method === "GET" && pathname === "/exports") {
    const files = fs.existsSync(EXPORTS_DIR)
      ? fs.readdirSync(EXPORTS_DIR).filter(f => !f.startsWith(".")).map(f => {
          const stat = fs.statSync(path.join(EXPORTS_DIR, f));
          return { name: f, size_bytes: stat.size, modified: stat.mtime.toISOString() };
        })
      : [];
    json(res, 200, { files, count: files.length });
    return;
  }

  if (req.method === "POST" && pathname === "/call") {
    let body: unknown;
    try { body = await readBody(req); } catch { json(res, 400, { success: false, error: "Invalid JSON body" }); return; }

    const { tool, params } = body as { tool?: string; params?: Record<string, unknown> };
    if (typeof tool !== "string" || !tool) { json(res, 400, { success: false, error: "Missing field: 'tool'" }); return; }

    const fn = TOOLS[tool];
    if (!fn) { json(res, 404, { success: false, error: `Unknown tool '${tool}'. Available: ${Object.keys(TOOLS).join(", ")}` }); return; }

    try {
      const result = await fn(params ?? {});
      json(res, 200, result);
    } catch (err) {
      json(res, 500, { success: false, error: String(err instanceof Error ? err.message : err), code: "TOOL_ERROR" });
    }
    return;
  }

  json(res, 404, { error: `Not found: ${req.method} ${pathname}` });
}

const server = http.createServer((req, res) => {
  handler(req, res).catch((err: unknown) => {
    if (!res.headersSent) json(res, 500, { success: false, error: "Internal server error" });
    process.stderr.write(`Unhandled: ${err}\n`);
  });
});

const shutdown = async () => { await bridge.stop(); server.close(); process.exit(0); };
process.on("SIGINT",  () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });

server.listen(PORT, () => {
  process.stderr.write(`cad-mcp HTTP server → http://localhost:${PORT}\n`);
  process.stderr.write(`  GET /health | GET /tools | GET /exports | POST /call\n`);
});
