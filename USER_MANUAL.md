# 📖 cad-mcp User Manual

Welcome to **cad-mcp**! This tool gives AI assistants like Claude, Cursor, and Windsurf the ability to natively design, assemble, and export 3D CAD models.

If you are a user looking to get this running and start creating 3D models with AI, this guide is for you.

---

## 🛠️ 1. Installation

### Prerequisites
You need three things installed on your computer:
1. **Node.js** (v22 or higher) — [Download here](https://nodejs.org/)
2. **Python** (v3.10 to v3.12) — [Download here](https://www.python.org/downloads/) *(Note: Python 3.13 and 3.14 are not fully supported by the underlying 3D engine yet).*
3. **uv** (Optional but highly recommended for fast Python installs) — [Install uv](https://github.com/astral-sh/uv)

### Setup Steps
Open your terminal (Command Prompt, PowerShell, or Terminal) and run:

```bash
# 1. Clone or download this repository
git clone https://github.com/PRATHVI9607/CAD_Autodesk_MCP.git
cd CAD_Autodesk_MCP

# 2. Install the TypeScript server
npm install
npm run build

# 3. Setup the Python 3D Engine (using uv)
uv venv .venv --python 3.12
uv pip install --python .venv -r python/requirements.txt
```

*(If you don't have `uv`, you can use standard Python: `python -m venv .venv` followed by `.venv\Scripts\pip install -r python/requirements.txt` on Windows).*

---

## 🔌 2. Connecting to Your AI Assistant

### For Claude Desktop
1. Open your Claude Desktop settings file:
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
   - **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the `cad-mcp` server to your configuration:

```json
{
  "mcpServers": {
    "cad-mcp": {
      "command": "node",
      "args": [
        "C:/Absolute/Path/To/CADmcp/dist/index.js"
      ]
    }
  }
}
```
*(Make sure to change `C:/Absolute/Path/To/CADmcp` to exactly where you downloaded the folder!)*
3. Restart Claude Desktop. You should see a hammer icon indicating the MCP tools are loaded.

### For Claude Code (CLI)
Navigate to the `CADmcp` folder in your terminal and simply run:
```bash
claude
```
Claude Code will automatically detect the MCP server listed in the `claude.json` file.

### For Cursor
1. Go to **Cursor Settings** > **Features** > **MCP Servers**.
2. Click **+ Add New MCP Server**.
3. Name it `cad-mcp`, set type to `command`, and set the command to: `node C:/Absolute/Path/To/CADmcp/dist/index.js`

---

## 🧠 3. How to Prompt the AI for Best Results

Designing 3D parts with Code/AI is slightly different than clicking around in CAD software. To get the best results, you need to enforce a few rules when prompting the AI.

**Always include these instructions in your prompt:**
1. **"CRITICAL: ONE tool call at a time. Wait for each to succeed before the next."** (This prevents the AI from getting confused if a 3D operation fails).
2. **"Construct the model step-by-step:"**
   - Create raw primitive parts first (`cad_create_model`).
   - Move them into place (`cad_translate_model`).
   - Merge them together (`boolean_union` via `cad_apply_operation`).
   - Repair the final mesh (`cad_repair_mesh`).
   - Export (`cad_export_model`).

---

## 🐢 4. Example Prompts

Here are a few copy-paste examples you can use to test the system.

### Example 1: A Cute 3D Turtle
This prompt demonstrates creating shapes, moving them, merging them into a single solid body, and exporting it for 3D printing.

```text
Using cad-mcp tools, build a cute 3D Turtle model. 
CRITICAL: ONE tool call at a time. Wait for each to succeed before the next.

== CREATE PARTS ==
1. cad_create_model — base_shape:"cylinder", parameters:{radius:35, height:15}, output_name:"shell_raw"
2. cad_apply_operation — name:"shell_raw", operation:"fillet", op_params:{radius:5}, output_name:"shell"

3. cad_create_model — base_shape:"sphere", parameters:{radius:12}, output_name:"head_raw"
4. cad_translate_model — name:"head_raw", x:0, y:40, z_offset:5, output_name:"head"

5. cad_create_model — base_shape:"cylinder", parameters:{radius:8, height:12}, output_name:"leg_raw"
6. cad_apply_operation — name:"leg_raw", operation:"fillet", op_params:{radius:3}, output_name:"leg"

7. cad_create_model — base_shape:"sphere", parameters:{radius:5}, output_name:"tail_raw"
8. cad_translate_model — name:"tail_raw", x:0, y:-35, z_offset:4, output_name:"tail"

== POSITION LEGS ==
9. cad_translate_model — name:"leg", x:25,  y:20,  z_offset:-3, output_name:"leg_fr"
10. cad_translate_model — name:"leg", x:-25, y:20,  z_offset:-3, output_name:"leg_fl"
11. cad_translate_model — name:"leg", x:25,  y:-20, z_offset:-3, output_name:"leg_rr"
12. cad_translate_model — name:"leg", x:-25, y:-20, z_offset:-3, output_name:"leg_rl"

== ASSEMBLE (boolean_union one by one) ==
13. cad_apply_operation — name:"shell", operation:"boolean_union", op_params:{other:"head"}, output_name:"t1"
14. cad_apply_operation — name:"t1",    operation:"boolean_union", op_params:{other:"tail"}, output_name:"t2"
15. cad_apply_operation — name:"t2",    operation:"boolean_union", op_params:{other:"leg_fr"}, output_name:"t3"
16. cad_apply_operation — name:"t3",    operation:"boolean_union", op_params:{other:"leg_fl"}, output_name:"t4"
17. cad_apply_operation — name:"t4",    operation:"boolean_union", op_params:{other:"leg_rr"}, output_name:"t5"
18. cad_apply_operation — name:"t5",    operation:"boolean_union", op_params:{other:"leg_rl"}, output_name:"turtle_raw"

== REPAIR & EXPORT ==
19. cad_repair_mesh — name:"turtle_raw", output_name:"turtle_complete"
20. cad_validate_model — name:"turtle_complete"
21. cad_export_model — name:"turtle_complete", format:"STEP", output_name:"turtle_final.step"
22. cad_export_model — name:"turtle_complete", format:"STL",  output_name:"turtle_final.stl"

List the exported file paths and validation info when done.
```

### Example 2: 250mm Quadcopter Frame
```text
Using cad-mcp tools, build a proper 250mm quadcopter drone frame (+ shaped).
CRITICAL: ONE tool call at a time. Wait for each to succeed before the next.

== PARTS ==
1. cad_create_model — base_shape:"box", parameters:{width:80,height:3,depth:80}, output_name:"body"
2. cad_apply_operation — name:"body", operation:"fillet", op_params:{radius:0.8}, output_name:"body_f"

3. cad_create_model — base_shape:"box", parameters:{width:100,height:4,depth:14}, output_name:"arm_x"
4. cad_apply_operation — name:"arm_x", operation:"fillet", op_params:{radius:0.8}, output_name:"arm_xf"

5. cad_create_model — base_shape:"box", parameters:{width:14,height:4,depth:100}, output_name:"arm_y"
6. cad_apply_operation — name:"arm_y", operation:"fillet", op_params:{radius:0.8}, output_name:"arm_yf"

7. cad_create_model — base_shape:"cylinder", parameters:{radius:9,height:5}, output_name:"mount"
8. cad_apply_operation — name:"mount", operation:"shell", op_params:{thickness:-2}, output_name:"mount_f"

== POSITION ARMS (overlapping body by 10mm) ==
9.  cad_translate_model — name:"arm_xf", x:85,  y:0, z_offset:0.5, output_name:"arm_front"
10. cad_translate_model — name:"arm_xf", x:-85, y:0, z_offset:0.5, output_name:"arm_rear"
11. cad_translate_model — name:"arm_yf", x:0, y:85,  z_offset:0.5, output_name:"arm_right"
12. cad_translate_model — name:"arm_yf", x:0, y:-85, z_offset:0.5, output_name:"arm_left"

== POSITION MOTOR MOUNTS (at arm tips, 130mm from center) ==
13. cad_translate_model — name:"mount_f", x:130, y:0,    z_offset:3, output_name:"mnt_front"
14. cad_translate_model — name:"mount_f", x:-130, y:0,   z_offset:3, output_name:"mnt_rear"
15. cad_translate_model — name:"mount_f", x:0, y:130,    z_offset:3, output_name:"mnt_right"
16. cad_translate_model — name:"mount_f", x:0, y:-130,   z_offset:3, output_name:"mnt_left"

== ASSEMBLE (union one at a time) ==
17. cad_apply_operation — name:"body_f", operation:"boolean_union", op_params:{other:"arm_front"}, output_name:"f1"
18. cad_apply_operation — name:"f1", operation:"boolean_union", op_params:{other:"arm_rear"}, output_name:"f2"
19. cad_apply_operation — name:"f2", operation:"boolean_union", op_params:{other:"arm_right"}, output_name:"f3"
20. cad_apply_operation — name:"f3", operation:"boolean_union", op_params:{other:"arm_left"}, output_name:"f4"
21. cad_apply_operation — name:"f4", operation:"boolean_union", op_params:{other:"mnt_front"}, output_name:"f5"
22. cad_apply_operation — name:"f5", operation:"boolean_union", op_params:{other:"mnt_rear"}, output_name:"f6"
23. cad_apply_operation — name:"f6", operation:"boolean_union", op_params:{other:"mnt_right"}, output_name:"f7"
24. cad_apply_operation — name:"f7", operation:"boolean_union", op_params:{other:"mnt_left"}, output_name:"frame_raw"

== REPAIR + EXPORT ==
25. cad_repair_mesh    — name:"frame_raw", output_name:"frame_complete"
26. cad_validate_model — name:"frame_complete"
27. cad_export_model   — name:"frame_complete", format:"STEP", output_name:"drone_frame.step"
28. cad_export_model   — name:"frame_complete", format:"STL", output_name:"drone_frame.stl"
```

## 📂 Finding Your Files
All generated 3D models are saved in the `models/exports/` directory inside the project folder. You can drag and drop these STL files straight into PrusaSlicer, Cura, or Bambu Studio!
