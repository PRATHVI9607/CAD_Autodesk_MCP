/**
 * cad-types.ts — Shared TypeScript types and Zod schemas for all cad-mcp tools.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export const ModelNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_\-]+$/, "Model name may only contain letters, digits, underscores and hyphens");

export const UnitsSchema = z.enum(["mm", "cm", "inch"]).default("mm");

// ---------------------------------------------------------------------------
// Base shapes
// ---------------------------------------------------------------------------

export const BaseShapeSchema = z.enum(["box", "cylinder", "sphere", "cone", "torus", "custom"]);

export const ModelParametersSchema = z.object({
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  depth: z.number().positive().optional(),
  radius: z.number().positive().optional(),
  radius_bottom: z.number().positive().optional(),
  radius_top: z.number().min(0).optional(),
  radius_major: z.number().positive().optional(),
  radius_minor: z.number().positive().optional(),
}).catchall(z.number());

// ---------------------------------------------------------------------------
// Tool input schemas
// ---------------------------------------------------------------------------

/** cad_create_model */
export const CreateModelSchema = z.object({
  description: z.string().optional().describe("Natural language description of the model"),
  parameters: ModelParametersSchema.optional().default({}),
  base_shape: BaseShapeSchema.default("box"),
  output_name: ModelNameSchema,
  units: UnitsSchema,
  material: z.string().optional().describe("Material metadata hint"),
});
export type CreateModelInput = z.infer<typeof CreateModelSchema>;

/** cad_export_model */
export const ExportFormatSchema = z.enum(["STL", "STEP", "OBJ", "GLTF", "DXF", "SVG"]);
export const ExportModelSchema = z.object({
  name: ModelNameSchema.describe("Model identifier to export"),
  format: ExportFormatSchema.default("STL"),
  output_name: ModelNameSchema.optional().describe("Override output filename (default: model name)"),
});
export type ExportModelInput = z.infer<typeof ExportModelSchema>;

/** cad_query_properties */
export const QueryPropertiesSchema = z.object({
  name: ModelNameSchema,
  density: z.number().positive().optional().describe("Material density in g/cm³ — enables mass calculation"),
});
export type QueryPropertiesInput = z.infer<typeof QueryPropertiesSchema>;

/** cad_apply_operation */
export const OperationSchema = z.enum([
  "extrude",
  "revolve",
  "fillet",
  "chamfer",
  "shell",
  "boolean_union",
  "boolean_difference",
  "boolean_intersection",
  "mirror",
  "pattern_linear",
  "pattern_circular",
]);

export const ApplyOperationSchema = z.object({
  name: ModelNameSchema.describe("Source model identifier"),
  operation: OperationSchema,
  output_name: ModelNameSchema.optional().describe("Result model name (default: overwrite source)"),
  op_params: z.record(z.unknown()).optional().default({}).describe(
    "Operation-specific parameters. " +
    "fillet/chamfer: {radius/length}. " +
    "shell: {thickness}. " +
    "extrude: {distance}. " +
    "revolve: {angle, axis_origin, axis_dir}. " +
    "boolean_*: {other_model}. " +
    "mirror: {plane: XY|XZ|YZ}. " +
    "pattern_linear: {direction, spacing, count}. " +
    "pattern_circular: {radius, count}."
  ),
});
export type ApplyOperationInput = z.infer<typeof ApplyOperationSchema>;

/** cad_render_preview */
export const RenderPreviewSchema = z.object({
  name: ModelNameSchema,
  output_name: ModelNameSchema.optional(),
  azimuth: z.number().min(0).max(360).default(45),
  elevation: z.number().min(-90).max(90).default(30),
  width: z.number().int().min(100).max(4096).default(800),
  height: z.number().int().min(100).max(4096).default(600),
});
export type RenderPreviewInput = z.infer<typeof RenderPreviewSchema>;

/** cad_validate_model */
export const ValidateModelSchema = z.object({
  name: ModelNameSchema,
  min_wall_thickness: z.number().positive().default(1.5).describe("Minimum wall thickness in mm"),
});
export type ValidateModelInput = z.infer<typeof ValidateModelSchema>;

/** cad_list_templates */
export const ListTemplatesSchema = z.object({
  category: z.enum(["mechanical", "architectural", "organic"]).optional(),
});
export type ListTemplatesInput = z.infer<typeof ListTemplatesSchema>;

/** cad_load_template */
export const LoadTemplateSchema = z.object({
  template_id: z.string().min(1).max(128),
  parameters: z.record(z.number()).optional().default({}),
  output_name: ModelNameSchema,
});
export type LoadTemplateInput = z.infer<typeof LoadTemplateSchema>;

/** cad_import_file */
export const ImportFileSchema = z.object({
  path: z.string().min(1).describe("Absolute or relative path to STL/STEP/OBJ file"),
  output_name: ModelNameSchema.optional(),
});
export type ImportFileInput = z.infer<typeof ImportFileSchema>;

/** cad_sketch_2d */
const SketchElementSchema = z.union([
  z.object({ type: z.literal("rect"),   width: z.number().positive(), height: z.number().positive() }),
  z.object({ type: z.literal("circle"), radius: z.number().positive(), cx: z.number().optional(), cy: z.number().optional() }),
  z.object({ type: z.literal("line"),   x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  z.object({ type: z.literal("arc"),    x1: z.number(), y1: z.number(), xm: z.number(), ym: z.number(), x2: z.number(), y2: z.number() }),
]);

export const Sketch2dSchema = z.object({
  output_name: ModelNameSchema,
  plane: z.enum(["XY", "XZ", "YZ"]).default("XY"),
  elements: z.array(SketchElementSchema).min(1).describe("List of sketch elements"),
});
export type Sketch2dInput = z.infer<typeof Sketch2dSchema>;

// ---------------------------------------------------------------------------
// Tool response types
// ---------------------------------------------------------------------------

export interface ToolSuccess<T = Record<string, unknown>> {
  success: true;
  data: T;
}

export interface ToolError {
  success: false;
  error: string;
  code: string;
}

export type ToolResult<T = Record<string, unknown>> = ToolSuccess<T> | ToolError;

export function toolOk<T>(data: T): ToolSuccess<T> {
  return { success: true, data };
}

export function toolErr(error: string, code = "CAD_ERROR"): ToolError {
  return { success: false, error, code };
}
