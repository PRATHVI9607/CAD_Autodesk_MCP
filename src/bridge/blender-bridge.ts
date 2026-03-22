/**
 * blender-bridge.ts — Optional Blender headless render bridge.
 *
 * Invokes Blender as a subprocess to render high-quality preview images.
 * Falls back gracefully if Blender is not installed.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLENDER_SCRIPT = path.resolve(__dirname, "../../python/blender_render.py");

const BLENDER_CMD = process.env["BLENDER_CMD"] ?? "blender";
const RENDER_TIMEOUT_MS = parseInt(process.env["CAD_MCP_RENDER_TIMEOUT_MS"] ?? "60000", 10);

export interface BlenderRenderOptions {
  modelPath: string;
  outputPath: string;
  azimuth?: number;
  elevation?: number;
  width?: number;
  height?: number;
}

/**
 * Render a model using Blender headless.
 * Throws if Blender is not installed or if rendering fails.
 */
export async function renderWithBlender(opts: BlenderRenderOptions): Promise<void> {
  const args = [
    "--background",
    "--python",
    BLENDER_SCRIPT,
    "--",
    "--model",    opts.modelPath,
    "--output",   opts.outputPath,
    "--azimuth",  String(opts.azimuth ?? 45),
    "--elevation",String(opts.elevation ?? 30),
    "--width",    String(opts.width ?? 800),
    "--height",   String(opts.height ?? 600),
  ];

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(BLENDER_CMD, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Blender render timed out after ${RENDER_TIMEOUT_MS / 1000}s`));
    }, RENDER_TIMEOUT_MS);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Blender exited with code ${code}. Stderr: ${stderr.slice(-500)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`Blender not found at '${BLENDER_CMD}'. Install Blender or use the default trimesh renderer.`));
      } else {
        reject(err);
      }
    });
  });
}
