/**
 * integration.test.ts — End-to-end integration test for cad-mcp
 *
 * Verifies the full pipeline: MCP tool call → Python geometry → file output.
 *
 * Requires:  cadquery to be installed in the Python environment.
 * Run with:  npm run test:integration
 */

import { describe, it, expect, afterAll } from "@jest/globals";
import { bridge } from "../../src/bridge/cadquery-bridge.js";

// Give CadQuery time to load (kernel init can be slow)
const TIMEOUT = 60_000;

afterAll(async () => {
  await bridge.stop();
});

describe("cad-mcp integration", () => {
  it("pings the Python server", async () => {
    const result = await bridge.call("ping", {});
    expect(result).toMatchObject({ pong: true });
  }, TIMEOUT);

  it("creates a box model", async () => {
    const result = await bridge.call("create_model", {
      output_name: "test_box",
      base_shape: "box",
      parameters: { width: 20, height: 10, depth: 5 },
      units: "mm",
    });
    expect(result).toMatchObject({
      name: "test_box",
      shape: "box",
    });
  }, TIMEOUT);

  it("creates a cylinder model", async () => {
    const result = await bridge.call("create_model", {
      output_name: "test_cyl",
      base_shape: "cylinder",
      parameters: { radius: 8, height: 20 },
      units: "mm",
    });
    expect(result).toMatchObject({ name: "test_cyl", shape: "cylinder" });
  }, TIMEOUT);

  it("exports box to STL", async () => {
    const result = await bridge.call("export_model", {
      name: "test_box",
      format: "STL",
      output_name: "test_box_export",
    });
    expect(result).toMatchObject({ format: "STL" });
    expect(typeof result["path"]).toBe("string");
    expect((result["size_bytes"] as number)).toBeGreaterThan(0);
  }, TIMEOUT);

  it("queries box properties", async () => {
    const result = await bridge.call("query_properties", {
      name: "test_box",
    });
    expect(typeof result["volume_mm3"]).toBe("number");
    expect((result["volume_mm3"] as number)).toBeGreaterThan(0);
    expect(result).toHaveProperty("bounding_box");
    expect(result).toHaveProperty("center_of_mass");
  }, TIMEOUT);

  it("applies fillet to box", async () => {
    const result = await bridge.call("apply_operation", {
      name: "test_box",
      operation: "fillet",
      output_name: "test_box_filleted",
      op_params: { radius: 1.0 },
    });
    expect(result).toMatchObject({ operation: "fillet", name: "test_box_filleted" });
  }, TIMEOUT);

  it("validates a model", async () => {
    const result = await bridge.call("validate_model", {
      name: "test_box",
      min_wall_thickness: 1.5,
    });
    expect(result).toHaveProperty("is_valid");
    expect(result).toHaveProperty("is_watertight");
    expect(Array.isArray(result["issues"])).toBe(true);
  }, TIMEOUT);

  it("lists templates (empty library is fine)", async () => {
    const result = await bridge.call("list_templates", {});
    expect(result).toHaveProperty("templates");
    expect(Array.isArray(result["templates"])).toBe(true);
    expect(typeof result["count"]).toBe("number");
  }, TIMEOUT);

  it("rejects negative dimensions", async () => {
    await expect(
      bridge.call("create_model", {
        output_name: "bad_model",
        base_shape: "box",
        parameters: { width: -10, height: 5, depth: 5 },
        units: "mm",
      })
    ).rejects.toThrow();
  }, TIMEOUT);

  it("rejects path traversal model names", async () => {
    await expect(
      bridge.call("export_model", {
        name: "test_box",
        format: "STL",
        output_name: "../escape",
      })
    ).rejects.toThrow();
  }, TIMEOUT);
});
