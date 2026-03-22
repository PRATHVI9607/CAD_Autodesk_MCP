/**
 * index.ts — cad-mcp MCP Server Entrypoint
 *
 * Registers all 10 CAD tools with the MCP SDK and connects the
 * stdio transport for use with Claude Desktop and other MCP clients.
 *
 * Run: node dist/index.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Tool implementations
import { createModel }     from "./tools/create-model.js";
import { exportModel }     from "./tools/export-model.js";
import { queryProperties } from "./tools/query-model.js";
import { applyOperation }  from "./tools/modify-model.js";
import { validateModel }   from "./tools/validate-model.js";
import {
  fusion360Upload,
  fusion360Render,
  fusion360Translate,
  fusion360Properties,
  fusion360Credentials,
} from "./tools/fusion360-tools.js";
import {
  listTemplates,
  loadTemplate,
  importFile,
  sketch2d,
} from "./tools/template-library.js";

import { bridge } from "./bridge/cadquery-bridge.js";

// ---------------------------------------------------------------------------
// Helper: convert a ToolResult to MCP content
// ---------------------------------------------------------------------------

function toMcpContent(result: { success: boolean; data?: unknown; error?: string }): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  if (result.success) {
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
  return {
    content: [{ type: "text", text: `Error: ${result.error}` }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "cad-mcp", version: "0.1.0" });

// ── Reusable sub-schemas ───────────────────────────────────────────────────

const ModelName = z.string().min(1).max(128).regex(/^[A-Za-z0-9_\-]+$/);
const Units     = z.enum(["mm", "cm", "inch"]).default("mm");

// ── Tool 1: cad_create_model ───────────────────────────────────────────────

server.tool(
  "cad_create_model",
  "Create a parametric 3D model from natural language and/or structured parameters. " +
  "Shapes: box, cylinder, sphere, cone, torus. Model is stored in memory.",
  {
    description: z.string().optional().describe("Natural language description"),
    base_shape:  z.enum(["box","cylinder","sphere","cone","torus","custom"]).default("box"),
    parameters:  z.object({
      width:         z.number().positive().optional(),
      height:        z.number().positive().optional(),
      depth:         z.number().positive().optional(),
      radius:        z.number().positive().optional(),
      radius_bottom: z.number().positive().optional(),
      radius_top:    z.number().min(0).optional(),
      radius_major:  z.number().positive().optional(),
      radius_minor:  z.number().positive().optional(),
    }).optional().default({}),
    output_name: ModelName.describe("Identifier for this model"),
    units:       Units,
    material:    z.string().optional().describe("Material hint (e.g. PLA, steel)"),
  },
  async (input) => toMcpContent(await createModel(input as Record<string, unknown>))
);

// ── Tool 2: cad_export_model ───────────────────────────────────────────────

server.tool(
  "cad_export_model",
  "Export a model to STL, STEP, OBJ, GLTF, DXF, or SVG. Returns the file path.",
  {
    name:        ModelName.describe("Model identifier"),
    format:      z.enum(["STL","STEP","OBJ","GLTF","DXF","SVG"]).default("STL"),
    output_name: ModelName.optional().describe("Output filename stem (default: model name)"),
  },
  async (input) => toMcpContent(await exportModel(input as Record<string, unknown>))
);

// ── Tool 3: cad_query_properties ──────────────────────────────────────────

server.tool(
  "cad_query_properties",
  "Get geometric properties: volume (mm³), surface area (mm²), bounding box, centre of mass; optionally mass.",
  {
    name:    ModelName,
    density: z.number().positive().optional().describe("Density in g/cm³ — enables mass calculation"),
  },
  async (input) => toMcpContent(await queryProperties(input as Record<string, unknown>))
);

// ── Tool 4: cad_apply_operation ───────────────────────────────────────────

server.tool(
  "cad_apply_operation",
  "Apply a geometric operation: extrude, revolve, fillet, chamfer, shell, " +
  "boolean_union/difference/intersection, mirror, pattern_linear, pattern_circular.",
  {
    name:      ModelName.describe("Source model"),
    operation: z.enum([
      "extrude","revolve","fillet","chamfer","shell",
      "boolean_union","boolean_difference","boolean_intersection",
      "mirror","pattern_linear","pattern_circular",
    ]),
    output_name: ModelName.optional().describe("Result model name (default: overwrite source)"),
    op_params:   z.record(z.unknown()).optional().default({})
      .describe("Op params — fillet:{radius}, chamfer:{length}, shell:{thickness}, extrude:{distance}, revolve:{angle}, boolean_*:{other_model}, mirror:{plane}, pattern_linear:{direction,spacing,count}, pattern_circular:{radius,count}"),
  },
  async (input) => toMcpContent(await applyOperation(input as Record<string, unknown>))
);

// ── Tool 5a: cad_fusion360_upload ─────────────────────────────────────────

server.tool(
  "cad_fusion360_upload",
  "Upload a CadQuery model to Autodesk Platform Services (APS / Forge) cloud storage. " +
  "Returns the base64 URN and a direct Forge Viewer URL you can open in any browser. " +
  "Requires APS_CLIENT_ID and APS_CLIENT_SECRET env vars.",
  {
    name:   ModelName.describe("Model identifier to upload"),
    format: z.enum(["STEP","STL","OBJ"]).default("STEP"),
  },
  async (input) => toMcpContent(await fusion360Upload(input as Record<string, unknown>))
);

// ── Tool 5b: cad_fusion360_render ─────────────────────────────────────────

server.tool(
  "cad_fusion360_render",
  "Upload a model to Autodesk APS and download a high-quality rendered thumbnail PNG. " +
  "Saves to models/previews/. Requires APS credentials.",
  {
    name:        ModelName.describe("Model identifier"),
    output_name: ModelName.optional().describe("Output filename stem"),
    width:       z.number().int().min(100).max(2000).default(800),
    height:      z.number().int().min(100).max(2000).default(600),
  },
  async (input) => toMcpContent(await fusion360Render(input as Record<string, unknown>))
);

// ── Tool 5c: cad_fusion360_translate ──────────────────────────────────────

server.tool(
  "cad_fusion360_translate",
  "Translate a model to SVF2 (Autodesk Forge Viewer format) or OBJ via APS Model Derivative API. " +
  "Returns a viewer_url that can be embedded in web apps. Requires APS credentials.",
  {
    name:          ModelName.describe("Model identifier"),
    output_format: z.enum(["svf2","obj","stl","thumbnail"]).default("svf2"),
  },
  async (input) => toMcpContent(await fusion360Translate(input as Record<string, unknown>))
);

// ── Tool 5d: cad_fusion360_properties ─────────────────────────────────────

server.tool(
  "cad_fusion360_properties",
  "Retrieve model properties (mass, materials, components, bounding box) " +
  "from Autodesk Platform Services after uploading and translating the model.",
  {
    name: ModelName.describe("Model identifier"),
  },
  async (input) => toMcpContent(await fusion360Properties(input as Record<string, unknown>))
);

// ── Tool 5e: cad_fusion360_credentials ────────────────────────────────────

server.tool(
  "cad_fusion360_credentials",
  "Check whether Autodesk Platform Services (APS) credentials are correctly configured. " +
  "Returns instructions if APS_CLIENT_ID or APS_CLIENT_SECRET are missing.",
  {},
  async (input) => toMcpContent(await fusion360Credentials(input as Record<string, unknown>))
);

// ── Tool 6: cad_validate_model ────────────────────────────────────────────

server.tool(
  "cad_validate_model",
  "Check a model for 3D printability: watertight, face normals, non-manifold edges, wall thickness.",
  {
    name:               ModelName,
    min_wall_thickness: z.number().positive().default(1.5).describe("Min wall thickness in mm"),
  },
  async (input) => toMcpContent(await validateModel(input as Record<string, unknown>))
);

// ── Tool 7: cad_list_templates ────────────────────────────────────────────

server.tool(
  "cad_list_templates",
  "List available model templates (mechanical, architectural, organic) with parameters.",
  {
    category: z.enum(["mechanical","architectural","organic"]).optional(),
  },
  async (input) => toMcpContent(await listTemplates(input as Record<string, unknown>))
);

// ── Tool 8: cad_load_template ─────────────────────────────────────────────

server.tool(
  "cad_load_template",
  "Instantiate a template with custom parameter values and store the model in memory.",
  {
    template_id: z.string().min(1).max(128).describe("Template ID from cad_list_templates"),
    parameters:  z.record(z.number()).optional().default({}),
    output_name: ModelName,
  },
  async (input) => toMcpContent(await loadTemplate(input as Record<string, unknown>))
);

// ── Tool 9: cad_import_file ───────────────────────────────────────────────

server.tool(
  "cad_import_file",
  "Import an existing STL, STEP, or OBJ file from the filesystem into the model registry.",
  {
    path:        z.string().min(1).describe("Absolute or relative path to the file"),
    output_name: ModelName.optional().describe("Name for the imported model"),
  },
  async (input) => toMcpContent(await importFile(input as Record<string, unknown>))
);

// ── Tool 10: cad_sketch_2d ────────────────────────────────────────────────

const SketchElement = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rect"),   width: z.number().positive(), height: z.number().positive() }),
  z.object({ type: z.literal("circle"), radius: z.number().positive(), cx: z.number().optional(), cy: z.number().optional() }),
  z.object({ type: z.literal("line"),   x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  z.object({ type: z.literal("arc"),    x1: z.number(), y1: z.number(), xm: z.number(), ym: z.number(), x2: z.number(), y2: z.number() }),
]);

server.tool(
  "cad_sketch_2d",
  "Create a 2D sketch on XY/XZ/YZ plane. Elements: rect, circle, line, arc. " +
  "Extrudable via cad_apply_operation with operation=extrude.",
  {
    output_name: ModelName,
    plane:       z.enum(["XY","XZ","YZ"]).default("XY"),
    elements:    z.array(SketchElement).min(1).describe("Sketch elements"),
  },
  async (input) => toMcpContent(await sketch2d(input as Record<string, unknown>))
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await bridge.stop();
    process.exit(0);
  };

  process.on("SIGINT",  () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });

  await server.connect(transport);
  process.stderr.write("cad-mcp MCP server ready (stdio)\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
