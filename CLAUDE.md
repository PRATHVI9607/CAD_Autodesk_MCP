# CLAUDE.md — cad-mcp Project Memory

> This file is the authoritative reference for AI coding assistants working on this project.
> **Update it whenever architecture, tools, or deployment steps change.**

---

## What This Project Is

**`cad-mcp`** is a production-ready MCP server that exposes 11 CAD / 3D-modelling tools to
any MCP-compatible AI client (Claude Code, Claude Desktop, etc.).  It lets Claude create,
edit, validate, export, and reason about 3D models backed by **CadQuery / OpenCASCADE**.

---

## Architecture

```
MCP Client (Claude Code / Claude Desktop)
    │  stdio transport (JSON-RPC 2.0, MCP protocol)
    ▼
src/index.ts          — 11 tools, Zod input validation, StdioServerTransport
src/http-server.ts    — optional REST wrapper on port 3000 (for testing)
    │  JSON-RPC 2.0 over subprocess stdin/stdout
    ▼
python/cadquery_server.py   — persistent geometry server
    ├─ CadQuery / OpenCASCADE  (parametric BRep modelling)
    ├─ trimesh                 (mesh validation, repair, OBJ/GLTF export)
    └─ validators.py           (3D-printability checks)
    ▼
models/exports/    models/previews/    (all output confined here)
```

The TypeScript bridge (`src/bridge/cadquery-bridge.ts`) spawns **one persistent Python
subprocess** per server lifetime and multiplexes JSON-RPC 2.0 requests over its stdin/stdout.
Python auto-detection order: `.venv/Scripts/python.exe` → `.venv/bin/python` → system
`python3` / `python` (override with `CAD_MCP_PYTHON_CMD` env var).

---

## Key Files

| Path | Purpose |
|------|---------|
| `src/index.ts` | MCP server entry point — all 11 tools registered here |
| `src/http-server.ts` | HTTP REST wrapper for integration testing (port 3000) |
| `src/bridge/cadquery-bridge.ts` | Python subprocess manager (JSON-RPC, auto Python detection) |
| `src/tools/` | Individual tool handlers (create, export, query, modify, validate, templates) |
| `src/types/cad-types.ts` | Zod schemas & TypeScript types shared across tools |
| `python/cadquery_server.py` | Geometry server — all 11 RPC handlers |
| `python/validators.py` | trimesh-based mesh validation (watertight, manifold, wall thickness) |
| `python/requirements.txt` | Python dependencies |
| `templates/` | 9 parametric JSON templates (mechanical / architectural / organic) |
| `.mcp.json` | Claude Code MCP server config (no secrets, no absolute paths) |
| `scripts/setup.ps1` | Windows one-shot Python venv + deps installer |
| `scripts/setup.sh` | macOS/Linux one-shot Python venv + deps installer |

---

## All 11 MCP Tools

| Tool | What it does |
|------|-------------|
| `cad_create_model` | Parametric solid: box / cylinder / sphere / cone / torus |
| `cad_export_model` | Export to STL, STEP, OBJ, GLTF, DXF, SVG |
| `cad_query_properties` | Volume (mm³), surface area (mm²), bounding box, centre of mass, optional mass |
| `cad_apply_operation` | fillet, chamfer, shell, extrude, revolve, boolean union/difference/intersection, mirror, pattern_linear, pattern_circular |
| `cad_validate_model` | Watertight, manifold, winding, non-manifold edges, wall-thickness check |
| `cad_list_templates` | Browse 9 templates (mechanical / architectural / organic) |
| `cad_load_template` | Instantiate a template with custom parameters |
| `cad_import_file` | Import STL / STEP / OBJ into memory |
| `cad_sketch_2d` | 2D sketch (rect, circle, line, arc) on XY / XZ / YZ plane |
| `cad_translate_model` | Move a model by (x, y, z) offset in mm |
| `cad_repair_mesh` | Fix STL mesh for 3D printing (winding, normals, holes) |

> There are NO Fusion 360 / APS tools currently registered.  The files
> `src/bridge/fusion360-bridge.ts` and `src/tools/fusion360-tools.ts` exist but are **not
> wired up** in `src/index.ts`.  Do not claim they work.

---

## Trimesh vs CadQuery Models

Models in memory fall into two types:

| Type | Created by | Stored as |
|------|-----------|-----------|
| **CadQuery Workplane** | `create_model`, `apply_operation`, `load_template`, `sketch_2d`, STEP import | `cq.Workplane` |
| **Trimesh mesh** | STL import, OBJ import | `trimesh.Trimesh` |

The Python server auto-detects which type it's holding (`_is_trimesh_model(model)`) and
routes to the correct code path.  Trimesh models support: STL / OBJ / GLTF export,
validate, repair, and query_properties.  They **do not** support STEP / DXF / SVG export
or geometric operations (fillet, boolean, etc.) — for those, use `cad_create_model`.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| MCP SDK | `@modelcontextprotocol/sdk` ^1.12.0 (Node.js / TypeScript) |
| Input validation | Zod ^3.23.8 |
| CAD kernel | CadQuery ≥ 2.3.0, OpenCASCADE via `cadquery-ocp` |
| Mesh analysis | `trimesh` ≥ 4.4.0, `scipy` ≥ 1.10.0 |
| Python constraint | **3.9 – 3.12 only** (`cadquery-ocp` has no wheels for 3.13+) |
| HTTP test harness | Built-in Node `http` server on port 3000 |
| Build | TypeScript 5.x → ES2022 / Node16 modules → `dist/` |

---

## Coding Conventions

### TypeScript
- Strict mode; all tools return `{ success, data }` or `{ success, error }` via `toolOk` / `toolErr`
- Never expose raw exceptions — catch in handler, return `{ isError: true }` to MCP client
- ESM throughout (`"type": "module"`) — imports use `.js` extensions even for `.ts` sources

### Python
- Type hints everywhere (`list[str]` not `List[str]`)
- JSON-RPC 2.0 over stdin/stdout; all logging goes to **stderr** / log file (never stdout)
- 30 s geometry timeout, 60 s render timeout (configurable via env vars)
- `TEMPLATES_DIR` resolved from `__file__` location — safe regardless of working directory

### Security
- **CRITICAL**: Never write files outside `./models/` — `_safe_output_path()` enforces this
- All tool inputs validated with Zod (TypeScript) and manual guards (Python)
- Path traversal rejected by regex + `startswith(EXPORTS_DIR)` check

---

## Quick Start (Development)

```powershell
# 1. Install Node deps & build TypeScript
npm install        # also runs `npm run build` via the prepare hook

# 2. Set up Python (Windows)
.\scripts\setup.ps1

# 3. Configure Claude Code to use this server
# .mcp.json is already correct — just open this project in Claude Code

# 4. (Optional) run the HTTP test server
npm run start:http    # → http://localhost:3000

# 5. (Optional) run HTTP integration tests
npm run test:http
```

---

## Deployment (Install Anywhere)

### Option A — npx (no global install)
Add to Claude Desktop's `claude_desktop_config.json` or your `.mcp.json`:
```json
{
  "mcpServers": {
    "cad-mcp": {
      "command": "npx",
      "args": ["-y", "cad-mcp"],
      "env": {
        "CAD_MCP_MODELS_DIR": "/absolute/path/to/your/models"
      }
    }
  }
}
```

### Option B — global npm install
```bash
npm install -g cad-mcp
```
Then configure:
```json
{
  "mcpServers": {
    "cad-mcp": {
      "command": "cad-mcp",
      "env": {
        "CAD_MCP_MODELS_DIR": "/absolute/path/to/your/models",
        "CAD_MCP_PYTHON_CMD": "python3"
      }
    }
  }
}
```

### Option C — clone + build
```bash
git clone <repo>
cd cad-mcp
npm install          # builds dist/ automatically via prepare hook
./scripts/setup.sh   # or .\scripts\setup.ps1 on Windows
```

### Python requirement
Python **3.9 – 3.12** is required.  The server auto-detects:
1. `.venv/Scripts/python.exe` (Windows) or `.venv/bin/python` (Unix) inside the package dir
2. System `python3` / `python`

Override with `CAD_MCP_PYTHON_CMD=/path/to/python` in the MCP server env config.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CAD_MCP_PYTHON_CMD` | auto-detected | Path to Python 3.9-3.12 executable |
| `CAD_MCP_MODELS_DIR` | `./models` | Directory for exported files and previews |
| `CAD_MCP_LOGS_DIR` | `./logs` | Directory for server log files |
| `CAD_MCP_GEOMETRY_TIMEOUT_MS` | `30000` | Geometry operation timeout (ms) |
| `CAD_MCP_RENDER_TIMEOUT_MS` | `60000` | Render / preview timeout (ms) |

---

## Important Notes for AI Assistants

1. **11 tools, not 14** — the CLAUDE.md used to say 14 (included unregistered Fusion 360 tools); actual registered count is 11.
2. **Never skip input validation** — Zod in TypeScript, regex + dimension guards in Python.
3. **Python subprocess is persistent** — the bridge keeps one process alive; don't spawn one-shots.
4. **Models directory is sacred** — `_safe_output_path()` must be used for all file writes.
5. **Trimesh models are a separate type** — check `_is_trimesh_model(model)` before calling `model.val()` or `cq.exporters.export()`.
6. **Python path auto-detected** — don't add absolute paths back to `.mcp.json`; use the `CAD_MCP_PYTHON_CMD` env var if needed.
7. **`prepare` hook builds on `npm install`** — `dist/` is auto-populated after cloning; don't commit `dist/` to git.
