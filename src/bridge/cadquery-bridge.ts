/**
 * cadquery-bridge.ts — TypeScript ↔ Python subprocess bridge.
 *
 * Manages a persistent Python subprocess running cadquery_server.py,
 * communicates via newline-delimited JSON-RPC 2.0 over stdin/stdout.
 */

import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config (from environment with sensible defaults)
// ---------------------------------------------------------------------------

const PYTHON_CMD = process.env["CAD_MCP_PYTHON_CMD"] ?? "python";
const GEOMETRY_TIMEOUT_MS = parseInt(process.env["CAD_MCP_GEOMETRY_TIMEOUT_MS"] ?? "30000", 10);
const RENDER_TIMEOUT_MS = parseInt(process.env["CAD_MCP_RENDER_TIMEOUT_MS"] ?? "60000", 10);
const PYTHON_SCRIPT = path.resolve(__dirname, "../../python/cadquery_server.py");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

type PendingCall = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// ---------------------------------------------------------------------------
// Bridge implementation
// ---------------------------------------------------------------------------

/**
 * CadQueryBridge manages the lifecycle of the Python geometry subprocess.
 * It is a singleton — call `CadQueryBridge.getInstance()`.
 */
export class CadQueryBridge {
  private static instance: CadQueryBridge | null = null;

  private child: ChildProcess | null = null;
  private pending: Map<number, PendingCall> = new Map();
  private nextId = 1;
  private ready = false;
  private startPromise: Promise<void> | null = null;

  private constructor() {}

  /** Return the singleton bridge instance. */
  static getInstance(): CadQueryBridge {
    if (!CadQueryBridge.instance) {
      CadQueryBridge.instance = new CadQueryBridge();
    }
    return CadQueryBridge.instance;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Ensure the subprocess is running. Called lazily before each request. */
  async ensureStarted(): Promise<void> {
    if (this.ready) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._spawn();
    return this.startPromise;
  }

  private async _spawn(): Promise<void> {
    if (!fs.existsSync(PYTHON_SCRIPT)) {
      throw new Error(
        `Python geometry server not found at: ${PYTHON_SCRIPT}\n` +
        `Make sure python/cadquery_server.py exists.`
      );
    }

    const workDir = path.resolve(__dirname, "../..");

    this.child = spawn(PYTHON_CMD, [PYTHON_SCRIPT], {
      cwd: workDir,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stderr = this.child.stderr;
    if (stderr) {
      stderr.on("data", (chunk: Buffer) => {
        process.stderr.write(`[python] ${chunk.toString()}`);
      });
    }

    this.child.on("exit", (code) => {
      process.stderr.write(`[bridge] Python subprocess exited with code ${code ?? "null"}\n`);
      this.ready = false;
      this.startPromise = null;
      this.child = null;
      // Reject all pending calls
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Python subprocess exited unexpectedly (code ${code})`));
      }
      this.pending.clear();
    });

    const stdout = this.child.stdout;
    if (!stdout) throw new Error("Python subprocess has no stdout.");

    const rl = createInterface({ input: stdout, crlfDelay: Infinity });

    return new Promise<void>((resolveStart, rejectStart) => {
      let started = false;

      rl.on("line", (line) => {
        if (!line.trim()) return;

        let msg: JsonRpcResponse & { method?: string };
        try {
          msg = JSON.parse(line) as JsonRpcResponse & { method?: string };
        } catch {
          process.stderr.write(`[bridge] Unparseable line from Python: ${line}\n`);
          return;
        }

        // Server-ready notification
        if (!started && msg.method === "server_ready") {
          started = true;
          this.ready = true;
          resolveStart();
          return;
        }

        // Match to a pending call
        const id = msg.id;
        const call = this.pending.get(id);
        if (!call) {
          process.stderr.write(`[bridge] Received response for unknown id ${id}\n`);
          return;
        }
        clearTimeout(call.timer);
        this.pending.delete(id);

        if (msg.error) {
          call.reject(
            Object.assign(new Error(msg.error.message), { code: msg.error.code })
          );
        } else {
          call.resolve(msg.result ?? {});
        }
      });

      // Startup timeout — if server_ready not received within 10 s, fail
      const startupTimer = setTimeout(() => {
        if (!started) {
          rejectStart(
            new Error(
              "Python geometry server did not start within 10 seconds. " +
              "Check that CadQuery is installed: pip install cadquery"
            )
          );
          this.child?.kill();
        }
      }, 10_000);

      this.child!.on("exit", () => {
        clearTimeout(startupTimer);
        if (!started) {
          rejectStart(new Error("Python subprocess exited before sending server_ready."));
        }
      });
    });
  }

  /** Stop the subprocess gracefully. */
  async stop(): Promise<void> {
    if (this.child) {
      this.child.stdin?.end();
      this.child.kill("SIGTERM");
      this.child = null;
    }
    this.ready = false;
    this.startPromise = null;
    CadQueryBridge.instance = null;
  }

  // ── RPC helpers ───────────────────────────────────────────────────────────

  /**
   * Call a Python geometry method and await the result.
   * @param method  JSON-RPC method name
   * @param params  Parameters object
   * @param timeout Timeout ms (default: GEOMETRY_TIMEOUT_MS)
   */
  async call(
    method: string,
    params: Record<string, unknown>,
    timeout: number = GEOMETRY_TIMEOUT_MS
  ): Promise<Record<string, unknown>> {
    await this.ensureStarted();

    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Geometry operation '${method}' timed out after ${timeout / 1000}s. ` +
            "Operation may be too complex or Python is not running."
          )
        );
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });

      const line = JSON.stringify(request) + "\n";
      this.child!.stdin!.write(line, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error(`Failed to write to Python subprocess: ${err.message}`));
        }
      });
    });
  }

  /** Convenience wrapper for render operations (longer timeout). */
  async render(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.call(method, params, RENDER_TIMEOUT_MS);
  }
}

/** Module-level singleton accessor. */
export const bridge = CadQueryBridge.getInstance();
