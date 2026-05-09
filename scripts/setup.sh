#!/usr/bin/env bash
# setup.sh — One-shot setup for cad-mcp on macOS / Linux
# Run from the project root:  bash scripts/setup.sh
#
# What it does:
#   1. Checks for Python 3.9-3.12 (required by cadquery-ocp)
#   2. Creates a .venv virtual environment
#   3. Installs Python dependencies (cadquery, trimesh, scipy)
#   4. Prints next steps

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. Find a suitable Python ─────────────────────────────────────────────
step "Looking for Python 3.9-3.12..."
PYTHON_CMD=""
for candidate in python3.12 python3.11 python3.10 python3.9 python3 python; do
    if command -v "$candidate" &>/dev/null; then
        ver=$("$candidate" --version 2>&1 || true)
        if [[ "$ver" =~ Python\ 3\.(9|10|11|12) ]]; then
            PYTHON_CMD="$candidate"
            echo "  Found: $ver  ($candidate)"
            break
        fi
    fi
done

if [[ -z "$PYTHON_CMD" ]]; then
    fail "Python 3.9-3.12 not found in PATH.
cadquery-ocp requires Python 3.9-3.12 (no wheels for 3.13+).

Install options:
  - macOS (Homebrew):  brew install python@3.12
  - Ubuntu/Debian:     sudo apt install python3.12 python3.12-venv
  - uv:                uv python install 3.12
  - pyenv:             pyenv install 3.12"
fi

# ── 2. Create .venv ───────────────────────────────────────────────────────
VENV_DIR="$ROOT/.venv"
step "Creating virtual environment at $VENV_DIR..."

if [[ -d "$VENV_DIR" ]]; then
    echo "  .venv already exists — skipping creation"
else
    "$PYTHON_CMD" -m venv "$VENV_DIR"
    echo "  Created."
fi

PIP="$VENV_DIR/bin/pip"
PYTHON_VENV="$VENV_DIR/bin/python"

# ── 3. Upgrade pip ────────────────────────────────────────────────────────
step "Upgrading pip..."
"$PYTHON_VENV" -m pip install --quiet --upgrade pip

# ── 4. Install Python dependencies ────────────────────────────────────────
REQ_FILE="$ROOT/python/requirements.txt"
step "Installing Python dependencies from requirements.txt..."
echo "  (cadquery-ocp is large; this may take 2-5 minutes on first run)"
"$PIP" install --quiet -r "$REQ_FILE"

# ── 5. Verify ─────────────────────────────────────────────────────────────
step "Verifying installation..."
CQ_VER=$("$PYTHON_VENV" -c "import cadquery; print(cadquery.__version__)" 2>&1)
TM_VER=$("$PYTHON_VENV" -c "import trimesh; print(trimesh.__version__)" 2>&1)
echo "  CadQuery: $CQ_VER"
echo "  trimesh:  $TM_VER"

# ── 6. Next steps ─────────────────────────────────────────────────────────
printf '\n\033[32mSetup complete!\033[0m\n\n'
cat <<'EOF'
Next steps:
  1. Build TypeScript (if not already done):
       npm install

  2. Open this project in Claude Code — the MCP server will start automatically.
     The server detects .venv automatically; no extra config needed.

  3. Or start the HTTP test server:
       npm run start:http

  CAD_MCP_PYTHON_CMD is not required — .venv is auto-detected.
EOF
