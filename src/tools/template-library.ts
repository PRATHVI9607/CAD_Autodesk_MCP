/**
 * template-library.ts — Template library tool implementations.
 *
 * Handles: cad_list_templates, cad_load_template, cad_import_file, cad_sketch_2d
 */

import { bridge } from "../bridge/cadquery-bridge.js";
import {
  ListTemplatesSchema,
  LoadTemplateSchema,
  ImportFileSchema,
  Sketch2dSchema,
  toolOk,
  toolErr,
  type ToolResult,
} from "../types/cad-types.js";

/**
 * cad_list_templates
 *
 * Lists all available templates in the library with their metadata,
 * parameter definitions, and category. Optionally filter by category.
 */
export async function listTemplates(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = ListTemplatesSchema.safeParse(rawInput);
  if (!parsed.success) {
    return toolErr(
      `Invalid parameters: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      "INVALID_PARAMS"
    );
  }

  try {
    const result = await bridge.call("list_templates", {
      ...(parsed.data.category ? { category: parsed.data.category } : {}),
    });
    return toolOk(result);
  } catch (err) {
    return toolErr(String(err instanceof Error ? err.message : err), "LIST_TEMPLATES_FAILED");
  }
}

/**
 * cad_load_template
 *
 * Instantiates a template from the library with custom parameter values.
 * The resulting model is stored in memory under the specified output_name.
 */
export async function loadTemplate(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = LoadTemplateSchema.safeParse(rawInput);
  if (!parsed.success) {
    return toolErr(
      `Invalid parameters: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      "INVALID_PARAMS"
    );
  }

  const input = parsed.data;

  try {
    const result = await bridge.call("load_template", {
      template_id: input.template_id,
      parameters: input.parameters ?? {},
      output_name: input.output_name,
    });
    return toolOk(result);
  } catch (err) {
    return toolErr(String(err instanceof Error ? err.message : err), "LOAD_TEMPLATE_FAILED");
  }
}

/**
 * cad_import_file
 *
 * Imports an existing STL, STEP, or OBJ file from the local filesystem
 * into the in-memory model registry for further use.
 */
export async function importFile(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = ImportFileSchema.safeParse(rawInput);
  if (!parsed.success) {
    return toolErr(
      `Invalid parameters: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      "INVALID_PARAMS"
    );
  }

  const input = parsed.data;

  try {
    const result = await bridge.call("import_file", {
      path: input.path,
      ...(input.output_name ? { output_name: input.output_name } : {}),
    });
    return toolOk(result);
  } catch (err) {
    return toolErr(String(err instanceof Error ? err.message : err), "IMPORT_FAILED");
  }
}

/**
 * cad_sketch_2d
 *
 * Creates a 2D sketch on a specified plane using geometric primitives
 * (lines, arcs, circles, rectangles). The sketch is stored as a model
 * that can be extruded with cad_apply_operation.
 */
export async function sketch2d(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = Sketch2dSchema.safeParse(rawInput);
  if (!parsed.success) {
    return toolErr(
      `Invalid parameters: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      "INVALID_PARAMS"
    );
  }

  const input = parsed.data;

  try {
    const result = await bridge.call("sketch_2d", {
      output_name: input.output_name,
      plane: input.plane,
      elements: input.elements,
    });
    return toolOk(result);
  } catch (err) {
    return toolErr(String(err instanceof Error ? err.message : err), "SKETCH_FAILED");
  }
}
