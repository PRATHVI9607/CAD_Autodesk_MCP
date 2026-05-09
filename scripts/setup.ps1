# setup.ps1 — One-shot setup for cad-mcp on Windows
# Run from the project root:  .\scripts\setup.ps1
#
# What it does:
#   1. Checks for Python 3.9-3.12 (required by cadquery-ocp)
#   2. Creates a .venv virtual environment
#   3. Installs Python dependencies (cadquery, trimesh, scipy)
#   4. Prints the next steps

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Fail([string]$msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

# ── 1. Find a suitable Python ──────────────────────────────────────────────
Write-Step "Looking for Python 3.9-3.12..."

$PythonCmd = $null
foreach ($candidate in @("python", "python3", "py")) {
    try {
        $ver = & $candidate --version 2>&1
        if ($ver -match "Python (3\.(9|10|11|12))") {
            $PythonCmd = $candidate
            Write-Host "  Found: $ver  ($candidate)"
            break
        }
    } catch {}
}

if (-not $PythonCmd) {
    Fail @"
Python 3.9-3.12 not found in PATH.
cadquery-ocp requires Python 3.9-3.12 (no wheels for 3.13+).

Install options:
  - Windows: https://www.python.org/downloads/  (choose 3.12.x)
  - uv:      uv python install 3.12
  - pyenv-win: pyenv install 3.12.x
"@
}

# ── 2. Create .venv ────────────────────────────────────────────────────────
$VenvDir = Join-Path $Root ".venv"
Write-Step "Creating virtual environment at $VenvDir..."

if (Test-Path $VenvDir) {
    Write-Host "  .venv already exists — skipping creation"
} else {
    & $PythonCmd -m venv $VenvDir
    Write-Host "  Created."
}

$PipExe = Join-Path $VenvDir "Scripts\pip.exe"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"

# ── 3. Upgrade pip ────────────────────────────────────────────────────────
Write-Step "Upgrading pip..."
& $PythonExe -m pip install --quiet --upgrade pip

# ── 4. Install Python dependencies ────────────────────────────────────────
$ReqFile = Join-Path $Root "python\requirements.txt"
Write-Step "Installing Python dependencies from requirements.txt..."
Write-Host "  (cadquery-ocp is large; this may take 2-5 minutes on first run)"
& $PipExe install --quiet -r $ReqFile

if ($LASTEXITCODE -ne 0) {
    Fail "pip install failed. Check the error above."
}

# ── 5. Verify ─────────────────────────────────────────────────────────────
Write-Step "Verifying installation..."
$cqVer = & $PythonExe -c "import cadquery; print(cadquery.__version__)" 2>&1
Write-Host "  CadQuery: $cqVer"
$tmVer = & $PythonExe -c "import trimesh; print(trimesh.__version__)" 2>&1
Write-Host "  trimesh:  $tmVer"

# ── 6. Next steps ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Build TypeScript (if not already done):"
Write-Host "       npm install"
Write-Host ""
Write-Host "  2. Open this project in Claude Code — the MCP server will start automatically."
Write-Host "     The server detects .venv automatically; no extra config needed."
Write-Host ""
Write-Host "  3. Or start the HTTP test server:"
Write-Host "       npm run start:http"
Write-Host ""
Write-Host "  CAD_MCP_PYTHON_CMD is not required — .venv is auto-detected."
