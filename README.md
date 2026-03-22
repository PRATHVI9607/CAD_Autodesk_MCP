# cad-mcp — CAD & 3D Modelling MCP Server

> **Production-quality MCP server** that gives AI assistants (Claude, Cursor, etc.)
> real CAD superpowers — create, edit, export, and validate 3D models without opening
> SolidWorks, Fusion 360, or Blender.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-yellow)](https://www.python.org/)
[![CadQuery](https://img.shields.io/badge/CadQuery-2.4%2B-green)](https://cadquery.readthedocs.io/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.27-purple)](https://github.com/modelcontextprotocol/typescript-sdk)

---

## ✨ What It Does

Ask Claude:
> *"Create an M6 bolt, apply a fillet to the edges, export to STL, and validate it for FDM printing."*

And it just works.

---

## 🛠️ 14 MCP Tools

**Core CAD (9 tools)**

| Tool | Description |
|------|-------------|
| `cad_create_model` | Create box, cylinder, sphere, cone, or torus from parameters |
| `cad_export_model` | Export to STL, STEP, OBJ, GLTF, DXF, or SVG |
| `cad_query_properties` | Get volume, surface area, bounding box, centre of mass |
| `cad_apply_operation` | Fillet, chamfer, shell, extrude, revolve, boolean ops, mirror, pattern |
| `cad_validate_model` | Check 3D printability — watertight, manifold, wall thickness |
| `cad_list_templates` | Browse the mechanical / architectural / organic template library |
| `cad_load_template` | Instantiate a template with custom parameters |
| `cad_import_file` | Import an existing STL / STEP / OBJ into memory |
| `cad_sketch_2d` | Create 2D sketches (line, arc, circle, rect) on any plane |

**Autodesk Fusion 360 / APS (5 tools)**

| Tool | Description |
|------|-------------|
| `cad_fusion360_upload` | Upload model to Autodesk cloud — returns URN + Forge Viewer URL |
| `cad_fusion360_render` | Upload + translate + download high-quality PNG thumbnail (APS) |
| `cad_fusion360_translate` | Translate model to SVF2 (Forge Viewer), OBJ, or STL via APS |
| `cad_fusion360_properties` | Get mass, materials, bounding box from Autodesk |
| `cad_fusion360_credentials` | Check APS credentials config |

---

## 🏗️ Architecture

```
Claude Desktop / Cursor / Any MCP Client
          │  stdio (MCP protocol)
          ▼
  src/index.ts  ──  14 MCP tools  ──  cad-types.ts (Zod validation)
          │  JSON-RPC 2.0 over stdio
          ▼
  python/cadquery_server.py (persistent subprocess)
          │
  CadQuery → OpenCASCADE geometry kernel
          │          └─ fusion360_bridge.py → Autodesk APS REST API
          │
  models/exports/   models/previews/
```

---

## 📦 Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | ≥ 22 |
| Python | ≥ 3.10 |
| CadQuery | ≥ 2.4.0 |

---

## 🚀 Quick Start

### 1. Install dependencies

```powershell
# TypeScript layer
npm install

# Python geometry engine (in a venv recommended)
cd python
pip install -r requirements.txt
```

> **Windows note:** CadQuery on Windows works best via conda:
> ```powershell
> conda install -c conda-forge cadquery
> pip install trimesh pymeshlab
> ```

### 2. Build

```powershell
npm run build
```

### 3. Connect to Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cad-mcp": {
      "command": "node",
      "args": ["C:/Workspace/CADmcp/dist/index.js"]
    }
  }
}
```

### 4. Try it out

In Claude: *"Create a 20×10×5 mm box, fillet all edges by 1 mm, and export to STL."*

---

## 🧪 Testing

### Python unit tests (no CadQuery needed)
```powershell
cd python && pytest tests/ -v
```

### TypeScript type-check
```powershell
npm run typecheck
```

### Integration tests (requires CadQuery)
```powershell
npm run test:integration
```

### HTTP server for TestSprite / API testing
```powershell
npm run start:http    # starts http://localhost:3000
curl http://localhost:3000/health
curl http://localhost:3000/tools
# POST /call — { "tool": "cad_create_model", "params": { ... } }
```

See `TESTSPRITE_SETUP.md` for full TestSprite integration guide.

---

## 📁 Project Structure

```
cad-mcp/
├── src/
│   ├── index.ts              # MCP server entrypoint (10 tools)
│   ├── http-server.ts        # HTTP wrapper for testing
│   ├── bridge/
│   │   ├── cadquery-bridge.ts  # TS ↔ Python subprocess manager
│   │   └── blender-bridge.ts   # Optional Blender render bridge
│   ├── tools/                # One file per tool
│   │   ├── create-model.ts
│   │   ├── export-model.ts
│   │   ├── query-model.ts
│   │   ├── modify-model.ts
│   │   ├── render-preview.ts
│   │   ├── validate-model.ts
│   │   └── template-library.ts
│   └── types/
│       └── cad-types.ts      # Zod schemas + TypeScript types
├── python/
│   ├── cadquery_server.py    # JSON-RPC geometry server (10 handlers)
│   ├── validators.py         # Mesh validation (trimesh)
│   ├── blender_render.py     # Headless Blender renderer
│   ├── requirements.txt
│   └── tests/                # pytest test suite
├── templates/
│   ├── mechanical/           # bolt_m6, nut_m6, bracket_l, gear_spur
│   ├── architectural/        # wall_section, column_round, slab_flat
│   └── organic/              # blob_sphere, ring_torus
├── models/
│   ├── exports/              # Generated STL/STEP/OBJ/GLTF files
│   └── previews/             # Generated PNG preview images
├── logs/                     # Server logs
├── PRD.md                    # Product requirements (for TestSprite)
├── TESTSPRITE_SETUP.md       # TestSprite testing guide
├── plan.md                   # Living implementation plan
└── CLAUDE.md                 # AI assistant memory
```

---

## 🔒 Security

- All output files are strictly confined to `./models/`
- Model names validated against `/^[A-Za-z0-9_\-]{1,128}$/`
- Negative / zero dimensions are rejected
- Geometry operations time out after 30 s
- Render operations time out after 60 s
- No raw Python stack traces exposed to MCP clients

---
