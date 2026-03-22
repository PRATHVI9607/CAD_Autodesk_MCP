# 📋 Product Requirements Document — cad-mcp

**Version:** 1.0  
**Date:** 2026-03-22  
**Project:** cad-mcp — CAD & 3D Model MCP Server  
**Type:** Backend API / MCP Tool Server

---

## 1. Product Overview

`cad-mcp` is a production-quality **Model Context Protocol (MCP) server** that exposes CAD and 3D modelling capabilities as structured AI tools. It allows Claude and any MCP-compatible AI client to create, modify, export, and validate 3D models without manually opening SolidWorks, Fusion 360, or Blender.

The server has two transport modes:
- **stdio** — for local Claude Desktop integration
- **HTTP/SSE** — for remote access and testing (port 3000)

---

## 2. System Architecture

```
MCP Client (Claude)
        ↓ stdio / HTTP
  cad-mcp TypeScript Server (Node.js, port 3000 in HTTP mode)
        ↓ JSON-RPC over subprocess stdin/stdout
  Python CadQuery Geometry Engine
        ↓
  Output files → models/exports/, models/previews/
```

---

## 3. API Endpoints (HTTP Mode)

Base URL: `http://localhost:3000`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check — returns `{ status: "ok", version: "0.1.0" }` |
| `/tools` | GET | List all 10 registered MCP tools |
| `/call` | POST | Execute a tool call `{ tool, params }` → `{ result }` |
| `/models` | GET | List all currently loaded in-memory models |
| `/exports` | GET | List all exported files in `models/exports/` |

---

## 4. Functional Requirements

### FR-1: Model Creation (`cad_create_model`)
- **Given** a user provides a base shape (box/cylinder/sphere/cone/torus) and dimension parameters
- **When** `cad_create_model` is called
- **Then** the model is created in memory, stored under the given `output_name`
- **Must** reject negative or zero dimensions with a descriptive error
- **Must** reject output names containing path traversal characters

### FR-2: Model Export (`cad_export_model`)
- **Given** a model exists in memory
- **When** `cad_export_model` is called with format STL/STEP/OBJ/GLTF/DXF/SVG
- **Then** a file is written to `./models/exports/{name}.{ext}`
- **Then** the response includes `path` and `size_bytes > 0`
- **Must** never write files outside `./models/` directory

### FR-3: Geometric Properties (`cad_query_properties`)
- **Given** a model exists in memory
- **When** `cad_query_properties` is called
- **Then** response includes `volume_mm3`, `surface_area_mm2`, `bounding_box`, `center_of_mass`
- **If** `density` is provided, response also includes `mass_g` and `mass_kg`
- Volume of a 10×10×10 mm box **must** equal 1000.0 mm³ (±0.1%)

### FR-4: Geometric Operations (`cad_apply_operation`)
- Supports: `fillet`, `chamfer`, `shell`, `extrude`, `revolve`, `boolean_union`, `boolean_difference`, `boolean_intersection`, `mirror`, `pattern_linear`, `pattern_circular`
- **Given** operation `fillet` with `radius: 1.0`
- **When** applied to a box model
- **Then** result model is stored under output_name without error

### FR-5: Preview Rendering (`cad_render_preview`)
- **When** called on any valid model
- **Then** a PNG file is written to `./models/previews/{name}_preview.png`
- **Then** `size_bytes > 0`
- **Must** complete within 60 seconds

### FR-6: Model Validation (`cad_validate_model`)
- **When** called on a well-formed closed solid
- **Then** `is_valid: true`, `is_watertight: true`, `issues: []`
- **When** called with `min_wall_thickness: 5.0` on a thin shape
- **Then** `thin_wall_warning: true` in response

### FR-7: Template Library (`cad_list_templates`, `cad_load_template`)
- `cad_list_templates` **must** return `{ templates: [], count: 0 }` when library is empty (not an error)
- `cad_load_template` **must** return a 404-style error when template ID is not found

### FR-8: File Import (`cad_import_file`)
- **When** a valid STL/STEP/OBJ path is provided
- **Then** model is loaded into memory under `output_name`
- **When** file does not exist
- **Then** structured error `{ success: false, error: "File not found: ..." }`

### FR-10 — Autodesk Fusion 360 / APS (`cad_fusion360_*`)
- **Given** `APS_CLIENT_ID` + `APS_CLIENT_SECRET` are set
- **When** `cad_fusion360_upload` is called
- **Then** model exported as STEP and uploaded to Autodesk OSS; `urn` + `viewer_url` returned
- **When** `cad_fusion360_render` is called
- **Then** model translated to SVF2 and thumbnail PNG downloaded to `models/previews/`
- **When** `cad_fusion360_credentials` is called without credentials
- **Then** response includes setup instructions (not an error crash)
- All APS calls gracefully fail with instructions if credentials are not set

---

## 5. Security Requirements

| Rule | Requirement |
|------|-------------|
| SEC-1 | All output file paths must resolve inside `./models/` |
| SEC-2 | `output_name` must match `/^[A-Za-z0-9_\-]{1,128}$/` |
| SEC-3 | Negative/zero dimensions must be rejected |
| SEC-4 | Geometry operations time out after 30 seconds |
| SEC-5 | Render operations time out after 60 seconds |

---

## 6. Error Handling Requirements

- All tool responses must be one of:
  - `{ success: true, data: {...} }` 
  - `{ success: false, error: "human-readable message", code: "ERROR_CODE" }`
- Never expose raw Python stack traces to MCP clients
- Invalid input must return HTTP 400 (or MCP error) with a message identifying the bad parameter

---

## 7. Performance Requirements

| Metric | Target |
|--------|--------|
| Server startup (stdio) | < 5 seconds |
| Box model creation | < 5 seconds |
| STL export (simple solid) | < 10 seconds |
| Property query | < 5 seconds |
| PNG preview render | < 60 seconds |

---

## 8. Test Scenarios

### Scenario 1 — Happy Path: Box Workflow
1. `cad_create_model` → box 20×10×5 mm → expect `success: true`
2. `cad_export_model` → STL → expect file exists + `size_bytes > 0`
3. `cad_query_properties` → expect `volume_mm3 ≈ 1000.0`
4. `cad_apply_operation` → fillet, radius=1 → expect `success: true`
5. `cad_validate_model` → expect `is_valid: true`

### Scenario 2 — Security: Rejection Tests
1. Negative dimension → expect `success: false`
2. Path traversal output name `../evil` → expect `success: false`
3. Unknown model name → expect `success: false, error contains "not found"`

### Scenario 3 — Edge Cases
1. Empty template library → `cad_list_templates` returns `count: 0` (not error)
2. Missing file import → structured error
3. Invalid operation name → descriptive error listing supported operations

### Scenario 4 — Render
1. Create a sphere, call `cad_render_preview` → PNG file written to disk

---

## 9. Tech Stack Summary

| Component | Technology |
|-----------|-----------|
| MCP Layer | TypeScript, `@modelcontextprotocol/sdk` 1.27.1 |
| Input Validation | Zod 3.x |
| CAD Engine | Python 3.10+, CadQuery ≥ 2.4.0 |
| Mesh Validation | trimesh |
| Transport | stdio (primary), HTTP port 3000 (test mode) |
| Runtime | Node.js 22+ |
