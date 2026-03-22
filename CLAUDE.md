# CLAUDE.md — cad-mcp Project Memory

> This file gives AI coding assistants context to work on this project effectively.
> **Update this file whenever architecture or tools change.**

---

## 🎯 What This Project Is

**`cad-mcp`** is a production-quality MCP server that exposes CAD and 3D modelling
capabilities as structured tools. It lets Claude — or any MCP-compatible AI client —
create, edit, export, and reason about 3D models, then push them to **Autodesk Fusion 360 / APS**.

---

## 🏗️ Architecture

```
Claude / MCP Client
    │ stdio (MCP) / HTTP port 3000 (testing)
    ▼
src/index.ts — 14 tools registered (Zod validation)
src/http-server.ts — REST wrapper for TestSprite
    │ JSON-RPC 2.0 over subprocess stdin/stdout
    ▼
python/cadquery_server.py — persistent geometry server
    │                        ├─ CadQuery / OpenCASCADE
    │                        ├─ trimesh (mesh validation)
    │                        └─ fusion360_bridge.py (APS REST API)
    ▼
models/exports/   models/previews/   (all output stays here)
```

---

## 📁 Key Files

| Path | Purpose |
|------|---------|
| `plan.md` | Full implementation plan — source of truth |
| `PRD.md` | Product requirements (used by TestSprite) |
| `src/index.ts` | All 14 tools registered here |
| `src/http-server.ts` | HTTP wrapper for TestSprite (port 3000) |
| `src/bridge/cadquery-bridge.ts` | Python subprocess manager |
| `src/bridge/fusion360-bridge.ts` | APS cloud bridge (TypeScript) |
| `src/tools/fusion360-tools.ts` | 5 Fusion 360 / APS tool handlers |
| `python/cadquery_server.py` | JSON-RPC geometry + Fusion 360 handlers |
| `python/fusion360_bridge.py` | APS REST API — OAuth, upload, translate, thumbnail |
| `python/validators.py` | Mesh validation (printability, manifold) |
| `python/requirements.txt` | Python deps (cadquery, trimesh, requests) |
| `templates/` | 9 parametric component templates |
| `.mcp.json` | MCP config — APS_CLIENT_ID / APS_CLIENT_SECRET here |

---

## 🔧 All 14 MCP Tools

### Core CAD (9 tools)
| Tool | What it does |
|------|-------------|
| `cad_create_model` | Box / cylinder / sphere / cone / torus from parameters |
| `cad_export_model` | Export to STL, STEP, OBJ, GLTF, DXF, SVG |
| `cad_query_properties` | Volume (mm³), surface area, bounding box, CoM |
| `cad_apply_operation` | Fillet, chamfer, shell, extrude, boolean, mirror, pattern |
| `cad_validate_model` | Watertight, manifold, wall thickness check |
| `cad_list_templates` | List 9 mechanical/architectural/organic templates |
| `cad_load_template` | Instantiate template with custom parameters |
| `cad_import_file` | Import STL/STEP/OBJ into memory |
| `cad_sketch_2d` | 2D sketch (line, arc, circle, rect) on XY/XZ/YZ |

### Autodesk Fusion 360 / APS (5 tools)
| Tool | What it does |
|------|-------------|
| `cad_fusion360_upload` | Upload model to Autodesk cloud → URN + Forge Viewer URL |
| `cad_fusion360_render` | Upload + translate + download rendered PNG thumbnail |
| `cad_fusion360_translate` | Translate to SVF2 (Forge Viewer), OBJ, STL |
| `cad_fusion360_properties` | Get mass, materials, bounding box from APS |
| `cad_fusion360_credentials` | Check APS_CLIENT_ID / APS_CLIENT_SECRET config |

---

## ⚙️ Tech Stack

| Layer | Tech |
|-------|------|
| MCP SDK | `@modelcontextprotocol/sdk` 1.27.1 (Node.js/TS) |
| Validation | Zod 3.x |
| CAD kernel | CadQuery ≥ 2.4.0, OpenCASCADE (cadquery-ocp) |
| Mesh analysis | trimesh, pymeshlab |
| Cloud integration | Autodesk Platform Services (APS) REST API, `requests` |
| HTTP testing | Built-in Node `http` server on port 3000 |
| Testing | TestSprite MCP (`@testsprite/testsprite-mcp`) |
| Test autogen | `PRD.md` → TestSprite generates + runs test cases |

---

## 📐 Coding Conventions

### TypeScript
- Strict mode, full JSDoc on every exported function
- All tools return `{ success: true, data: ... }` or `{ success: false, error, code }`
- Never expose raw exceptions to the MCP client

### Python
- Type hints everywhere (`list[str]` not `List[str]`)
- JSON-RPC 2.0 over stdin/stdout
- 30s timeout for geometry, 180s for APS cloud calls
- `fusion360_bridge.py` is lazy-imported — no hard dep at startup

### Security
- **CRITICAL**: Never write files outside `./models/`
- Reject path traversal, negative dimensions, shell-injection
- APS tokens cached in memory, never logged in full

---

## 🧪 Testing

```powershell
# TypeScript build
npm run build

# Start HTTP server (uses .venv Python with CadQuery 2.7.0)
$env:CAD_MCP_PYTHON_CMD=".venv\Scripts\python.exe"
$env:CAD_MCP_MODELS_DIR="./models"
npm run start:http      # → http://localhost:3000

# Run full 24-test suite (in another terminal)
npm run test:http
```

---

## 🚦 Current Status

> **Phase 1–8 complete.** Project is production-ready.

| Phase | Status |
|-------|--------|
| 1. Foundation | ✅ Done |
| 2. Python Engine | ✅ Done |
| 3. TS MCP Layer | ✅ Done |
| 4. 10 MCP Tools | ✅ Done |
| 5. Integration & Polish | ✅ Done |
| 6. Verification | ✅ Done |
| 7. HTTP Test Suite (24/24) | ✅ Done |
| 8. Fusion 360 / APS | ✅ Done |
| 9. Final Cleanup | ✅ Done |

**24/24 HTTP tests pass** (`npm run test:http`). CadQuery 2.7.0 in `.venv` (Python 3.11 via uv).
**Next:** Set `APS_CLIENT_ID` + `APS_CLIENT_SECRET` in `.mcp.json` to enable Fusion 360 cloud tools.

---

## ⚠️ Important Notes for AI Assistants

1. **Always update `plan.md`** when making architectural changes
2. **Never skip input validation** — all tools must validate with Zod (TS) or manual checks (Python)
3. **Python subprocess is persistent** — bridge manages it, not one-shot calls
4. **Models directory is sacred** — all output paths validated to stay in `./models/`
5. **Fusion 360 tools need APS credentials** — graceful error if not set, never crash
6. **Check `everything-claude-code/skills/`** before implementing complex features
