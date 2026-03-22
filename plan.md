# 🏗️ cad-mcp — Implementation Plan

> **Last updated:** 2026-03-22  
> **Status:** ✅ Initial build complete — all 10 tools implemented, TypeScript compiles clean

---

## Overview

Build **`cad-mcp`** — a production-quality MCP (Model Context Protocol) server that gives Claude and any MCP-compatible AI client the ability to create, edit, export, and reason about CAD designs and 3D models without manually opening any CAD software.

The server bridges a TypeScript MCP layer to a Python CadQuery geometry engine via a JSON-RPC subprocess protocol.

---

## Architecture

```
cad-mcp/
├── CLAUDE.md                    ← Project memory (AI assistant guidance)
├── plan.md                      ← This file — updated as work progresses
├── package.json                 ← TypeScript MCP project
├── tsconfig.json                ← Strict mode TypeScript
├── .mcp.json                    ← MCP server configuration
├── src/
│   ├── index.ts                 ← MCP server entrypoint
│   ├── tools/
│   │   ├── create-model.ts      ← cad_create_model
│   │   ├── export-model.ts      ← cad_export_model
│   │   ├── modify-model.ts      ← cad_apply_operation
│   │   ├── query-model.ts       ← cad_query_properties
│   │   ├── render-preview.ts    ← cad_render_preview
│   │   ├── validate-model.ts    ← cad_validate_model
│   │   └── template-library.ts ← cad_list_templates, cad_load_template
│   ├── bridge/
│   │   ├── cadquery-bridge.ts   ← TypeScript ↔ Python subprocess
│   │   └── blender-bridge.ts    ← Optional Blender headless bridge
│   └── types/
│       └── cad-types.ts         ← Shared type definitions
├── python/
│   ├── cadquery_server.py       ← JSON-RPC stdin/stdout geometry server
│   ├── blender_render.py        ← Headless Blender render script
│   ├── validators.py            ← 3D print + mesh validation
│   └── requirements.txt
├── models/
│   ├── exports/                 ← Generated STL/STEP/OBJ/GLTF files
│   └── previews/                ← Generated PNG preview images
├── templates/
│   ├── mechanical/              ← Bolts, brackets, gears…
│   ├── architectural/           ← Walls, columns, slabs…
│   └── organic/                 ← Freeform and curved shapes
└── logs/
    └── cad-mcp.log
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| MCP Framework | `@modelcontextprotocol/sdk` (TypeScript) |
| CAD Engine | CadQuery ≥ 2.4.0 (Python) |
| Geometry Kernel | CadQuery + OpenCASCADE (OCC via cadquery-ocp) |
| Fallback Kernel | FreeCAD Python API (STEP import/export) |
| Preview Renderer | trimesh + matplotlib (fallback); Blender headless (optional) |
| Mesh Validation | trimesh, pymeshlab |
| Transport | stdio (local) + HTTP/SSE (remote) |
| Language | TypeScript (MCP layer) + Python 3.10+ (geometry) |

---

## MCP Tools — 10 Total

| # | Tool Name | Description |
|---|-----------|-------------|
| 1 | `cad_create_model` | Parametric 3D model from natural language / parameters |
| 2 | `cad_export_model` | Export to STL, STEP, OBJ, GLTF, DXF, SVG |
| 3 | `cad_query_properties` | Volume, surface area, bounding box, CoM, moment of inertia |
| 4 | `cad_apply_operation` | Extrude, revolve, fillet, chamfer, shell, boolean ops, pattern |
| 5 | `cad_render_preview` | PNG preview from camera angle |
| 6 | `cad_validate_model` | 3D printability, wall thickness, overhangs, manifold check |
| 7 | `cad_list_templates` | List template library with metadata |
| 8 | `cad_load_template` | Instantiate a template with parameters |
| 9 | `cad_import_file` | Import existing STL/STEP/OBJ into workspace |
| 10 | `cad_sketch_2d` | 2D sketch with lines, arcs, circles, splines |

---

## Implementation Order

1. **Project scaffold** — package.json, tsconfig.json, directory tree, .mcp.json
2. **Python geometry server** — `cadquery_server.py` with JSON-RPC protocol
3. **TypeScript ↔ Python bridge** — `cadquery-bridge.ts` subprocess manager
4. **`cad_create_model`** — box, cylinder, sphere (simplest case first)
5. **`cad_export_model`** — STL export first, then other formats
6. **`cad_query_properties`** — volume, surface area, bounding box
7. **`cad_apply_operation`** — start with fillet and extrude
8. **`cad_render_preview`** — trimesh + matplotlib fallback
9. **`cad_validate_model`** — watertight, wall thickness, overhangs
10. **Template library tools** — `cad_list_templates` + `cad_load_template`
11. **`.mcp.json` configuration** — finalize server config
12. **End-to-end integration test** — bolt M6 → export STL → validate

---

## Security & Safety Rules

- All file writes → `./models/` subdirectory only (never outside project root)
- Subprocess timeouts: 30s for geometry ops, 60s for renders
- Input validation: reject negative dimensions, path traversal, impossible geometry
- Log all operations to `./logs/cad-mcp.log`

---

## Quality Requirements

- TypeScript strict mode (`"strict": true` in tsconfig)
- Full JSDoc on every tool
- Structured error returns (never raw exceptions exposed to MCP client)
- Unit tests for Python geometry layer (`pytest`)
- Integration tests: MCP tool call → geometry → file output pipeline

---

## Python Dependencies

```
cadquery>=2.4.0
cadquery-ocp
numpy
scipy
trimesh
pymeshlab
open3d        # optional — point cloud ops
```

---

## Verification Plan

### Automated (Python)
```bash
cd python && pytest tests/ -v
```

### Automated (TypeScript)
```bash
npm run build   # tsc --noEmit for type errors
npm test        # jest integration tests
```

### End-to-End Test
```bash
node dist/index.js
# Then in Claude: "Create a bolt with M6 thread, export as STL, validate for printing"
```

---

## Change Log

| Date | Change |
|------|--------|
| 2026-03-22 | Initial plan created |
| 2026-03-22 | All 6 phases implemented — TypeScript build passes, 10 tools registered |
| 2026-03-22 | Phase 7 added: TestSprite testing layer (PRD.md, HTTP server, TESTSPRITE_SETUP.md) |
