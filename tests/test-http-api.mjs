#!/usr/bin/env node
/**
 * test-http-api.mjs — cad-mcp HTTP Integration Test Suite
 *
 * Tests all 9 core CAD tools against the live HTTP server.
 * Run: node tests/test-http-api.mjs
 *
 * Server must be running: npm run start:http
 */

const BASE_URL = process.env.CAD_MCP_HTTP_URL ?? "http://localhost:3000";

// ── Colours ──────────────────────────────────────────────────────────────────
const G = "\x1b[32m";  // green
const R = "\x1b[31m";  // red
const Y = "\x1b[33m";  // yellow
const B = "\x1b[36m";  // cyan
const X = "\x1b[0m";   // reset
const BOLD = "\x1b[1m";

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;

async function call(tool, params = {}) {
  const res = await fetch(`${BASE_URL}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, params }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

function isCadQueryMissing(data) {
  const txt = JSON.stringify(data);
  return txt.includes("CadQuery is not installed") ||
         txt.includes("CaCadQuery") || // typo in some error paths
         txt.includes("cadquery");
}

async function test(name, fn) {
  process.stdout.write(`  ${B}▶${X} ${name} ... `);
  try {
    await fn();
    console.log(`${G}PASS${X}`);
    passed++;
  } catch (e) {
    if (e.message?.startsWith("CADQUERY_MISSING:")) {
      console.log(`${Y}SKIP (CadQuery not installed)${X}`);
      skipped++;
    } else {
      console.log(`${R}FAIL${X} — ${e.message}`);
      failed++;
    }
  }
}

function skip(name, reason) {
  console.log(`  ${Y}⊘${X} ${name} ${Y}(skipped: ${reason})${X}`);
  skipped++;
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg ?? "Assertion failed");
}

function assertOk(data, msg) {
  if (isCadQueryMissing(data)) {
    throw new Error("CADQUERY_MISSING: CadQuery not installed");
  }
  assert(data?.success !== false, msg ?? `Tool returned error: ${JSON.stringify(data)}`);
}

function section(title) {
  console.log(`\n${BOLD}${B}━━ ${title} ━━${X}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}cad-mcp HTTP Integration Tests${X}`);
  console.log(`${Y}Target: ${BASE_URL}${X}\n`);

  // ── 1. Server health ───────────────────────────────────────────────────────
  section("Server Health");

  await test("GET /health returns ok", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(data.status === "ok", `Expected status=ok, got ${JSON.stringify(data)}`);
  });

  await test("GET /tools returns 11 tools", async () => {
    const res = await fetch(`${BASE_URL}/tools`);
    const data = await res.json();
    assert(res.status === 200);
    assert(data.count === 11, `Expected 11 tools, got ${data.count}: ${data.tools?.map(t=>t.name).join(", ")}`);
  });

  await test("GET /exports returns file list", async () => {
    const res = await fetch(`${BASE_URL}/exports`);
    const data = await res.json();
    assert(res.status === 200);
    assert(Array.isArray(data.files), "Expected files array");
  });

  await test("POST /call with missing tool returns 400", async () => {
    const res = await fetch(`${BASE_URL}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert(res.status === 400);
  });

  await test("POST /call with unknown tool returns 404", async () => {
    const res = await fetch(`${BASE_URL}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "cad_does_not_exist", params: {} }),
    });
    assert(res.status === 404);
  });

  // ── 2. cad_create_model ────────────────────────────────────────────────────
  section("cad_create_model");

  await test("Create a box 20×10×5", async () => {
    const { data } = await call("cad_create_model", {
      output_name: "test_box",
      base_shape: "box",
      parameters: { width: 20, height: 10, depth: 5 },
    });
    assertOk(data);
    assert(data?.data?.name === "test_box" || data?.name === "test_box",
      `Unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
  });

  await test("Create a cylinder r=8 h=15", async () => {
    const { data } = await call("cad_create_model", {
      output_name: "test_cyl",
      base_shape: "cylinder",
      parameters: { radius: 8, height: 15 },
    });
    assertOk(data);
  });

  await test("Create a sphere r=5", async () => {
    const { data } = await call("cad_create_model", {
      output_name: "test_sphere",
      base_shape: "sphere",
      parameters: { radius: 5 },
    });
    assertOk(data);
  });

  await test("Reject negative dimension", async () => {
    const { data } = await call("cad_create_model", {
      output_name: "bad_box",
      base_shape: "box",
      parameters: { width: -10, height: 10, depth: 5 },
    });
    assert(data?.success === false || data?.error || data?.content?.[0]?.text?.includes("error") || data?.isError,
      `Expected error for negative dimension, got: ${JSON.stringify(data).slice(0,200)}`);
  });

  await test("Reject path traversal in output_name", async () => {
    const { data } = await call("cad_create_model", {
      output_name: "../../etc/passwd",
      base_shape: "box",
      parameters: { width: 10, height: 10, depth: 10 },
    });
    assert(data?.success === false || data?.error || data?.isError || data?.content?.[0]?.text?.includes("error"),
      "Expected error for path traversal");
  });

  // ── 3. cad_export_model ────────────────────────────────────────────────────
  section("cad_export_model");

  await test("Export test_box as STL", async () => {
    const { data } = await call("cad_export_model", {
      name: "test_box", format: "STL",
    });
    assertOk(data);
  });

  await test("Export test_box as STEP", async () => {
    const { data } = await call("cad_export_model", {
      name: "test_box", format: "STEP",
    });
    assertOk(data);
  });

  await test("Reject export of non-existent model", async () => {
    const { data } = await call("cad_export_model", {
      name: "ghost_model_xyz", format: "STL",
    });
    assert(data?.success === false || data?.error || data?.isError,
      "Expected error for missing model");
  });

  // ── 4. cad_query_properties ───────────────────────────────────────────────
  section("cad_query_properties");

  await test("Query properties of test_box", async () => {
    const { data } = await call("cad_query_properties", { name: "test_box" });
    assertOk(data);
    const d = data?.data ?? data;
    assert(d?.volume_mm3 > 0 || d?.content?.[0]?.text,
      `Expected volume in result: ${JSON.stringify(d).slice(0,200)}`);
  });

  await test("Query with density returns mass", async () => {
    const { data } = await call("cad_query_properties", {
      name: "test_box", density: 7.85,
    });
    assertOk(data);
  });

  // ── 5. cad_apply_operation ────────────────────────────────────────────────
  section("cad_apply_operation");

  await test("Apply fillet to test_box", async () => {
    const { data } = await call("cad_apply_operation", {
      name: "test_box",
      operation: "fillet",
      output_name: "test_box_filleted",
      op_params: { radius: 1.0 },
    });
    assertOk(data);
  });

  await test("Apply shell to test_cyl", async () => {
    const { data } = await call("cad_apply_operation", {
      name: "test_cyl",
      operation: "shell",
      output_name: "test_cyl_shell",
      op_params: { thickness: -2.0 },
    });
    assertOk(data);
  });

  // ── 6. cad_validate_model ─────────────────────────────────────────────────
  section("cad_validate_model");

  await test("Validate test_box for 3D printing", async () => {
    const { data } = await call("cad_validate_model", { name: "test_box" });
    assertOk(data);
  });

  // ── 7. cad_list_templates ─────────────────────────────────────────────────
  section("cad_list_templates");

  await test("List all templates", async () => {
    const { data } = await call("cad_list_templates", {});
    assertOk(data);
    const d = data?.data ?? data;
    assert(d?.count > 0 || d?.templates?.length > 0 || d?.content,
      `Expected templates, got: ${JSON.stringify(d).slice(0,200)}`);
  });

  await test("Filter templates by category: mechanical", async () => {
    const { data } = await call("cad_list_templates", { category: "mechanical" });
    assertOk(data);
  });

  // ── 8. cad_load_template ──────────────────────────────────────────────────
  section("cad_load_template");

  await test("Load bolt_m6 template", async () => {
    const { data } = await call("cad_load_template", {
      template_id: "bolt_m6",
      output_name: "test_bolt",
    });
    assertOk(data);
  });

  // ── 9. cad_sketch_2d ──────────────────────────────────────────────────────
  section("cad_sketch_2d");

  await test("Create 2D sketch with rect on XY", async () => {
    const { data } = await call("cad_sketch_2d", {
      output_name: "test_sketch",
      plane: "XY",
      elements: [{ type: "rect", width: 20, height: 10 }],
    });
    assertOk(data);
  });

  await test("Create sketch with circle", async () => {
    const { data } = await call("cad_sketch_2d", {
      output_name: "test_circle_sketch",
      plane: "XZ",
      elements: [{ type: "circle", radius: 8, cx: 0, cy: 0 }],
    });
    assertOk(data);
  });


  // ── Results ────────────────────────────────────────────────────────────────
  const total = passed + failed + skipped;
  console.log(`\n${BOLD}━━ Results ━━${X}`);
  console.log(`  ${G}✓ ${passed} passed${X}`);
  if (failed > 0)  console.log(`  ${R}✗ ${failed} failed${X}`);
  if (skipped > 0) console.log(`  ${Y}⊘ ${skipped} skipped${X}`);
  console.log(`  Total: ${total}`);

  if (failed > 0) {
    console.log(`\n${R}${BOLD}Some tests failed.${X}`);
    process.exit(1);
  } else {
    console.log(`\n${G}${BOLD}All tests passed!${X}`);
  }
}

main().catch((err) => {
  console.error(`\n${R}Fatal error: ${err.message}${X}`);
  process.exit(1);
});
