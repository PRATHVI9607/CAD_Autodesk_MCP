/**
 * modify-model.ts — cad_apply_operation tool implementation.
 *
 * Applies a geometric operation (fillet, extrude, boolean, etc.)
 * to an existing model.
 */

import { bridge } from "../bridge/cadquery-bridge.js";
import { ApplyOperationSchema, toolOk, toolErr, type ToolResult } from "../types/cad-types.js";

/**
 * cad_apply_operation
 *
 * Applies one of 11 geometric operations to an in-memory model.
 * Supports: extrude, revolve, fillet, chamfer, shell, boolean ops,
 * mirror, and linear/circular patterns.
 */
export async function applyOperation(
  rawInput: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = ApplyOperationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return toolErr(
      `Invalid parameters: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      "INVALID_PARAMS"
    );
  }

  const input = parsed.data;

  try {
    const result = await bridge.call("apply_operation", {
      name: input.name,
      operation: input.operation,
      output_name: input.output_name ?? input.name,
      op_params: input.op_params ?? {},
    });
    return toolOk(result);
  } catch (err) {
    return toolErr(String(err instanceof Error ? err.message : err), "OPERATION_FAILED");
  }
}
