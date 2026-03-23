/**
 * index.ts — cad-mcp MCP Server Entrypoint
 *
 * Registers 9 core CAD tools with the MCP SDK.
 * Run: node dist/index.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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

// ---------------------------------------------------------------------------
// Helper
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

const ModelName = z.string().min(1).max(128).regex(/^[A-Za-z0-9_\-]+$/);
const Units     = z.enum(["mm", "cm", "inch"]).default("mm");

// ── Tool 1: cad_create_model ─────────────────────────────────────────────

server.tool(
  "cad_create_model",
  "Create a parametric 3D model. Shapes: box, cylinder, sphere, cone, torus. " +
  "Stored in memory by output_name.",
  {
    description: z.string().optional(),
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
    output_name: ModelName,
    units:       Units,
    material:    z.string().optional(),
  },
  async (input) => toMcpContent(await createModel(input as Record<string, unknown>))
);

// ── Tool 2: cad_export_model ─────────────────────────────────────────────

server.tool(
  "cad_export_model",
  "Export a model to STL, STEP, OBJ, GLTF, DXF, or SVG.",
  {
    name:        ModelName,
    format:      z.enum(["STL","STEP","OBJ","GLTF","DXF","SVG"]).default("STL"),
    output_name: z.string().min(1).max(128).regex(/^[A-Za-z0-9_\-\.]+$/).optional(),
  },
  async (input) => toMcpContent(await exportModel(input as Record<string, unknown>))
);

// ── Tool 3: cad_query_properties ─────────────────────────────────────────

server.tool(
  "cad_query_properties",
  "Get volume (mm³), surface area (mm²), bounding box, centre of mass. " +
  "Pass density (g/cm³) to get mass.",
  {
    name:    ModelName,
    density: z.number().positive().optional().describe("g/cm³ — e.g. steel=7.85, aluminium=2.7, PLA=1.24"),
  },
  async (input) => toMcpContent(await queryProperties(input as Record<string, unknown>))
);

// ── Tool 4: cad_apply_operation ──────────────────────────────────────────

server.tool(
  "cad_apply_operation",
  "Apply geometry operations: fillet, chamfer, shell, extrude, revolve, " +
  "boolean_union/difference/intersection, mirror, pattern_linear, pattern_circular. " +
  "IMPORTANT — fillet radius must be less than half the thinnest wall (e.g. 2mm plate → radius ≤ 0.8mm).",
  {
    name:      ModelName,
    operation: z.enum([
      "extrude","revolve","fillet","chamfer","shell",
      "boolean_union","boolean_difference","boolean_intersection",
      "mirror","pattern_linear","pattern_circular",
    ]),
    output_name: ModelName.optional(),
    op_params:   z.record(z.unknown()).optional().default({})
      .describe("Op params — fillet:{radius}, chamfer:{length}, shell:{thickness}, extrude:{distance}, revolve:{angle}, boolean_*:{other}, mirror:{plane}, pattern_linear:{direction,spacing,count}, pattern_circular:{radius,count}"),
  },
  async (input) => toMcpContent(await applyOperation(input as Record<string, unknown>))
);

// ── Tool 5: cad_validate_model ───────────────────────────────────────────

server.tool(
  "cad_validate_model",
  "Check a model for 3D printability: watertight, normals, non-manifold edges, wall thickness.",
  {
    name:               ModelName,
    min_wall_thickness: z.number().positive().default(1.5),
  },
  async (input) => toMcpContent(await validateModel(input as Record<string, unknown>))
);

// ── Tool 6: cad_list_templates ───────────────────────────────────────────

server.tool(
  "cad_list_templates",
  "List available model templates (mechanical, architectural, organic).",
  {
    category: z.enum(["mechanical","architectural","organic"]).optional(),
  },
  async (input) => toMcpContent(await listTemplates(input as Record<string, unknown>))
);

// ── Tool 7: cad_load_template ────────────────────────────────────────────

server.tool(
  "cad_load_template",
  "Instantiate a parametric template with custom parameter values.",
  {
    template_id: z.string().min(1).max(128),
    parameters:  z.record(z.number()).optional().default({}),
    output_name: ModelName,
  },
  async (input) => toMcpContent(await loadTemplate(input as Record<string, unknown>))
);

// ── Tool 8: cad_import_file ──────────────────────────────────────────────

server.tool(
  "cad_import_file",
  "Import an existing STL, STEP, or OBJ file into the model registry.",
  {
    path:        z.string().min(1),
    output_name: ModelName.optional(),
  },
  async (input) => toMcpContent(await importFile(input as Record<string, unknown>))
);

// ── Tool 9: cad_sketch_2d ────────────────────────────────────────────────

const SketchElement = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rect"),   width: z.number().positive(), height: z.number().positive() }),
  z.object({ type: z.literal("circle"), radius: z.number().positive(), cx: z.number().optional(), cy: z.number().optional() }),
  z.object({ type: z.literal("line"),   x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  z.object({ type: z.literal("arc"),    x1: z.number(), y1: z.number(), xm: z.number(), ym: z.number(), x2: z.number(), y2: z.number() }),
]);

server.tool(
  "cad_sketch_2d",
  "Create a 2D sketch (rect, circle, line, arc) on XY/XZ/YZ plane. " +
  "Extrudable via cad_apply_operation with operation=extrude.",
  {
    output_name: ModelName,
    plane:       z.enum(["XY","XZ","YZ"]).default("XY"),
    elements:    z.array(SketchElement).min(1),
  },
  async (input) => toMcpContent(await sketch2d(input as Record<string, unknown>))
);

// ---------------------------------------------------------------------------
// ── Tool 10: cad_translate_model ────────────────────────────────────────

server.tool(
  "cad_translate_model",
  "Move a model by (x, y, z) offset in mm. Use this to position parts before union — " +
  "e.g. move an arm 45mm in X and 45mm in Y so it sits at a drone frame corner.\n" +
  "IMPORTANT: Run ONE step at a time. Wait for each step to succeed before starting the next.",
  {
    name:        ModelName,
    x:           z.number().default(0).describe("X offset in mm"),
    y:           z.number().default(0).describe("Y offset in mm"),
    z_offset:    z.number().default(0).describe("Z offset in mm"),
    output_name: ModelName.optional(),
  },
  async (input) => {
    const { name, x, y, z_offset, output_name } = input as Record<string, unknown>;
    try {
      const result = await bridge.call("translate_model", { name, x, y, z: z_offset, output_name });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
    }
  }
);

// ── Tool 11: cad_repair_mesh ─────────────────────────────────────────────

server.tool(
  "cad_repair_mesh",
  "Repair a model's STL mesh for 3D printing — fixes winding, normals, holes, " +
  "removes degenerate and duplicate faces. Reports whether result is watertight.",
  {
    name:        ModelName,
    output_name: ModelName.optional(),
  },
  async (input) => {
    const { name, output_name } = input as Record<string, unknown>;
    try {
      const result = await bridge.call("repair_mesh", { name, output_name });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  const shutdown = async () => { await bridge.stop(); process.exit(0); };
  process.on("SIGINT",  () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });
  await server.connect(transport);
  process.stderr.write("cad-mcp ready — 11 CAD tools active (stdio)\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
