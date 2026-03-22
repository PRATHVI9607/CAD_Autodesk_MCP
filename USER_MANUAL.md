# 📐 cad-mcp User Manual

> **cad-mcp** is an AI-powered CAD assistant. You talk to Claude in plain English,
> and it builds, modifies, exports, and uploads real 3D models — no CAD software needed.

---

## Is My MCP Ready?

**Yes, 100%.** The server can handle virtually any CAD request you throw at it:

| Capability | Ready? |
|-----------|--------|
| Create primitive shapes (box, cylinder, sphere, cone, torus) | ✅ |
| Boolean operations (union, cut, intersect) | ✅ |
| Fillets, chamfers, shells | ✅ |
| Extrude + revolve from 2D sketches | ✅ |
| Import STL/STEP/OBJ from disk | ✅ |
| Export to STL, STEP, OBJ, GLTF, DXF, SVG | ✅ |
| Get volume, mass, surface area, bounding box | ✅ |
| Validate for 3D printing | ✅ |
| Load parametric templates (bolt, bracket, etc.) | ✅ |
| Upload to Autodesk cloud + get viewer URL | ✅ (needs APS key) |
| Cloud-rendered PNG thumbnail | ✅ (needs APS key) |

---

## 🚀 First-Time Setup

### 1. Install Python environment
```powershell
cd c:\Workspace\CADmcp
uv venv .venv --python 3.11
uv pip install --python .venv cadquery trimesh requests
```

### 2. Build the TypeScript server
```powershell
npm install
npm run build
```

### 3. Add to Claude Desktop
Edit your Claude Desktop config (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "cad-mcp": {
      "command": "node",
      "args": ["c:/Workspace/CADmcp/dist/index.js"],
      "env": {
        "CAD_MCP_PYTHON_CMD": "c:/Workspace/CADmcp/.venv/Scripts/python.exe",
        "CAD_MCP_MODELS_DIR": "c:/Workspace/CADmcp/models"
      }
    }
  }
}
```

Restart Claude Desktop — you'll see the 🔧 tool icon appear.

---

## 💬 Example Prompts (What You Can Say)

### Basic Shapes
```
"Create a box 50mm × 30mm × 20mm"
"Make a cylinder with radius 10mm and height 40mm"
"Create a hollow sphere with radius 25mm"
```

### Engineering Parts
```
"Create a bracket: 60mm × 40mm × 5mm plate with a 10mm hole in the centre"
"Make an M8 hex bolt with 30mm length"
"Load the bolt_m6 template and make it 50mm long"
```

### Modifications
```
"Apply a 2mm fillet to all edges of my_box"
"Shell my_cylinder with 1.5mm wall thickness"
"Mirror bracket along the YZ plane"
"Create a 3×3 rectangular pattern of my_part, 20mm spacing"
```

### Boolean Operations
```
"Subtract a 10mm cylinder from the centre of my_box"
"Union box1 and box2 together"
"Intersect sphere1 and cube1"
```

### Sketches → Extrusions
```
"Create a 2D sketch with a 30×20mm rectangle on XY, then extrude 15mm"
"Sketch a circle radius 12mm and extrude 25mm upward"
```

### Analysis & Export
```
"What's the volume and mass of my_bracket in steel (7.85 g/cm³)?"
"Export my_part as STL for 3D printing"
"Export my_assembly as STEP for CAD software"
"Check if my_model is 3D-printable"
```

### Autodesk Cloud (needs APS credentials)
```
"Upload my_part to Autodesk and give me the viewer link"
"Get me a rendered thumbnail of my_bracket"
"Translate my_model to SVF2 format"
```

---

## 🗂 File Locations

| What | Where |
|------|-------|
| Exported STL / STEP / OBJ / etc | `models/exports/` |
| Rendered PNG thumbnails | `models/previews/` |
| Server logs | `logs/cad-mcp.log` |
| Parametric templates | `templates/` |

---

## 🔑 Autodesk APS Setup (optional, for cloud features)

1. Go to **[aps.autodesk.com](https://aps.autodesk.com/)** — free account
2. Click **My Apps → Create App**, select **Data Management + Model Derivative**
3. Copy **Client ID** and **Client Secret**
4. Open `.mcp.json` and fill in:
```json
"APS_CLIENT_ID":     "your_client_id",
"APS_CLIENT_SECRET": "your_client_secret"
```
5. Restart the server — Fusion 360 cloud tools are now live

---

## 🧪 Run Tests

```powershell
# Start HTTP server
$env:CAD_MCP_PYTHON_CMD=".venv\Scripts\python.exe"
$env:CAD_MCP_MODELS_DIR="./models"
npm run start:http

# In another terminal — runs all 24 tests
npm run test:http
# Expected: ✓ 24 passed
```

---

## 🛠 Troubleshooting

| Problem | Fix |
|---------|-----|
| `CadQuery is not installed` | Run `uv pip install --python .venv cadquery` |
| `No module named 'OCP'` | Make sure `CAD_MCP_PYTHON_CMD` points to `.venv\Scripts\python.exe` |
| Fusion 360 tools say "not configured" | Add APS keys to `.mcp.json` (see above) |
| Port 3000 in use | Change `PORT=3001 npm run start:http` |
| Model not found | Create the model first with `cad_create_model`, then use it |

---

## 🔖 All 14 Tool Reference

```
cad_create_model        → shape, parameters → model in memory
cad_export_model        → name, format → file in models/exports/
cad_query_properties    → name, density? → volume, mass, bbox
cad_apply_operation     → name, operation, params → modified model
cad_validate_model      → name → printability report
cad_list_templates      → category? → template list
cad_load_template       → template_id, params → model
cad_import_file         → path → model in memory
cad_sketch_2d           → plane, elements → sketch model
cad_fusion360_upload    → name → URN + viewer URL
cad_fusion360_render    → name → PNG thumbnail
cad_fusion360_translate → name, format → SVF2/OBJ/STL
cad_fusion360_properties→ name → mass, materials, bbox
cad_fusion360_credentials→ (none) → config status
```
