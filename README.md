# cad-mcp — CAD & 3D Modelling MCP Server

> Give AI assistants real CAD superpowers — create, edit, validate, and export 3D models
> without opening SolidWorks, Fusion 360, or Blender.

[![npm version](https://img.shields.io/npm/v/cad-mcp)](https://www.npmjs.com/package/cad-mcp)
[![CI](https://github.com/PRATHVI9607/cad-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/PRATHVI9607/cad-mcp/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.9–3.12-yellow)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## What It Does

Ask Claude:
> *"Create an M6 bolt, fillet all edges by 0.5 mm, export to STL, then validate it for FDM printing."*

And it just works — no GUI, no scripts, pure conversation.

---

## 11 MCP Tools

| Tool | Description |
|------|-------------|
| `cad_create_model` | Create box, cylinder, sphere, cone, or torus from parameters |
| `cad_export_model` | Export to STL, STEP, OBJ, GLTF, DXF, or SVG |
| `cad_query_properties` | Volume, surface area, bounding box, centre of mass, optional mass |
| `cad_apply_operation` | Fillet, chamfer, shell, extrude, revolve, boolean ops, mirror, pattern |
| `cad_validate_model` | 3D printability check — watertight, manifold, wall thickness |
| `cad_list_templates` | Browse mechanical / architectural / organic template library |
| `cad_load_template` | Instantiate a template with custom parameters |
| `cad_import_file` | Import an existing STL / STEP / OBJ into memory |
| `cad_sketch_2d` | Create 2D sketches (line, arc, circle, rect) on any plane |
| `cad_translate_model` | Move a model by (x, y, z) offset in mm |
| `cad_repair_mesh` | Fix STL mesh for 3D printing — winding, normals, holes |

---

## Installation

### Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js ≥ 18** | [nodejs.org](https://nodejs.org) |
| **Python 3.9–3.12** | `cadquery-ocp` has no wheels for 3.13+ |

### Option 1 — npx (nothing to install)

```bash
npx -y cad-mcp
```

Add to Claude Desktop's config and npx handles everything else.

### Option 2 — Global npm install

```bash
npm install -g cad-mcp
```

Then run `cad-mcp` directly.

### Option 3 — Clone & build

```bash
git clone https://github.com/PRATHVI9607/cad-mcp.git
cd cad-mcp
npm install          # builds dist/ automatically
```

### Python setup (all options)

CadQuery must be installed in a Python 3.9–3.12 environment.
The server auto-detects a `.venv` next to the package; run the setup script once:

```bash
# macOS / Linux
bash scripts/setup.sh

# Windows PowerShell
.\scripts\setup.ps1
```

Or manually:
```bash
python3.12 -m venv .venv
source .venv/bin/activate          # macOS/Linux
# .venv\Scripts\activate           # Windows
pip install -r python/requirements.txt
```

---

## Configure Claude Desktop

Copy the appropriate block from [`claude_desktop_config_example.json`](claude_desktop_config_example.json)
into your Claude Desktop config file:

| Platform | Config file path |
|----------|-----------------|
| macOS    | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows  | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux    | `~/.config/Claude/claude_desktop_config.json` |

**Quickest setup (npx):**
```json
{
  "mcpServers": {
    "cad-mcp": {
      "command": "npx",
      "args": ["-y", "cad-mcp"],
      "env": {
        "CAD_MCP_MODELS_DIR": "/Users/you/cad-models"
      }
    }
  }
}
```

**Cloned repo:**
```json
{
  "mcpServers": {
    "cad-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/cad-mcp/dist/index.js"],
      "env": {
        "CAD_MCP_MODELS_DIR": "/Users/you/cad-models"
      }
    }
  }
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CAD_MCP_MODELS_DIR` | `./models` | Where exported files are saved |
| `CAD_MCP_PYTHON_CMD` | auto-detected | Path to Python 3.9-3.12 executable |
| `CAD_MCP_LOGS_DIR` | `./logs` | Server log file directory |
| `CAD_MCP_GEOMETRY_TIMEOUT_MS` | `30000` | Geometry op timeout (ms) |
| `CAD_MCP_RENDER_TIMEOUT_MS` | `60000` | Render/preview timeout (ms) |

Python auto-detection order: `.venv/Scripts/python.exe` → `.venv/bin/python` → system `python3`/`python`.
Override with `CAD_MCP_PYTHON_CMD` if needed.

---

## Architecture

```
MCP Client (Claude Desktop / Claude Code / Cursor / etc.)
    │  stdio transport — MCP protocol (JSON-RPC 2.0)
    ▼
dist/index.js              — 11 tools, Zod validation, StdioServerTransport
dist/http-server.js        — optional REST wrapper on port 3000 (testing)
    │  JSON-RPC 2.0 over subprocess stdin/stdout
    ▼
python/cadquery_server.py  — persistent geometry server
    ├─ CadQuery / OpenCASCADE  (parametric BRep modelling)
    ├─ trimesh                 (mesh validation, repair, OBJ/GLTF export)
    └─ validators.py           (3D-printability checks)
    ▼
CAD_MCP_MODELS_DIR/exports/    (STL, STEP, OBJ, GLTF, DXF, SVG)
CAD_MCP_MODELS_DIR/previews/   (PNG previews)
```

---

## Development

```bash
# Clone & install
git clone https://github.com/PRATHVI9607/cad-mcp.git
cd cad-mcp
npm install

# Set up Python
.\scripts\setup.ps1   # Windows
bash scripts/setup.sh # macOS/Linux

# Type-check
npm run typecheck

# Build
npm run build

# Start HTTP test server (port 3000)
npm run start:http

# Run integration tests
npm run test:http
```

---

## Security

- All output files are strictly confined to `CAD_MCP_MODELS_DIR` — path traversal is rejected
- Model names validated against `/^[A-Za-z0-9_\-]{1,128}$/`
- Negative / zero dimensions are rejected before reaching the CAD kernel
- Geometry operations time out after 30 s; renders after 60 s
- Python executable path validated against shell-injection characters
- No raw Python stack traces exposed to MCP clients
- HTTP test server binds to `localhost` only — do not expose to a network

---

## Templates

9 parametric templates ready to use:

| Category | Templates |
|----------|-----------|
| Mechanical | `bolt_m6`, `nut_m6`, `bracket_l`, `gear_spur` |
| Architectural | `wall_section`, `column_round`, `slab_flat` |
| Organic | `blob_sphere`, `ring_torus` |

```
# In Claude:
"Load the bolt_m6 template with shank_length=40 and export to STL."
```

---

## License

MIT — see [LICENSE](LICENSE).
