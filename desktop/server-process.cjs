// Starts and supervises the existing AURA server (server/index.mjs) as a child process.
// In the desktop app, Electron's own embedded Node runs it (ELECTRON_RUN_AS_NODE=1),
// so no separate Node.js install is needed. Plain Node only: no Electron imports here.
"use strict";

const { spawn } = require("node:child_process");
const net = require("node:net");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portIsFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

function anyFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** The preferred port when it is free (keeps the app on one origin), otherwise any free port. */
async function pickPort(preferred) {
  if (preferred && (await portIsFree(preferred))) return preferred;
  return anyFreePort();
}

/** GET /api/health on the local server; null when it isn't answering yet. */
function getHealth(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

class ServerProcess {
  /**
   * @param {object} o
   * @param {string} o.execPath  binary that runs the server (Electron's exe, or node in tests)
   * @param {string} o.root      project root containing server/index.mjs and build/
   * @param {object} o.env       environment for the server (AURA_DATA_DIR, GEMINI_API_KEY, ...)
   * @param {string} [o.logFile] server output is appended here
   * @param {string} [o.script]  entry script (default: desktop/server-entry.mjs)
   */
  constructor({ execPath, root, env, logFile, script }) {
    this.execPath = execPath;
    this.root = root;
    this.script = script || path.join(__dirname, "server-entry.mjs");
    this.env = env;
    this.logFile = logFile;
    this.port = null;
    this.child = null;
    this.exitInfo = null;
    this.exited = null;
    this.lines = [];
  }

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }

  _record(chunk) {
    const text = chunk.toString("utf8");
    if (this.log) this.log.write(text);
    for (const line of text.split(/\r?\n/)) if (line.trim()) this.lines.push(line);
    if (this.lines.length > 200) this.lines.splice(0, this.lines.length - 200);
  }

  /** The last lines the server printed, for error messages. */
  tail(n = 20) {
    return this.lines.slice(-n).join("\n");
  }

  start(port) {
    this.port = port;
    if (this.logFile) {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      this.log = fs.createWriteStream(this.logFile, { flags: "a" });
      this.log.write(`\n--- ${new Date().toISOString()} starting AURA server on port ${port} ---\n`);
    }
    // stdin stays open as a lifeline: server-entry.mjs exits when it closes (app quit, crash or kill)
    this.child = spawn(this.execPath, [this.script], {
      cwd: this.root,
      env: { ...this.env, ELECTRON_RUN_AS_NODE: "1", AURA_PORT: String(port) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdin.on("error", () => {});
    this.child.stdout.on("data", (c) => this._record(c));
    this.child.stderr.on("data", (c) => this._record(c));
    this.exited = new Promise((resolve) => {
      const done = (info) => {
        if (this.exitInfo) return;
        this.exitInfo = info;
        if (this.log) this.log.write(`--- server exited (${describeExit(info)}) ---\n`);
        resolve(info);
      };
      this.child.once("exit", (code, signal) => done({ code, signal }));
      this.child.once("error", (error) => done({ code: null, signal: null, error }));
    });
    return this;
  }

  /** Resolves with the health payload once the server answers; rejects if it exits or times out. */
  async waitUntilReady(timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exitInfo) {
        throw new Error(`The AURA server stopped while starting (${describeExit(this.exitInfo)}).\n\n${this.tail()}`);
      }
      const health = await getHealth(this.port);
      if (health && health.ok) return health;
      await sleep(250);
    }
    throw new Error(`The AURA server did not start within ${Math.round(timeoutMs / 1000)} s.\n\n${this.tail()}`);
  }

  get running() {
    return Boolean(this.child) && !this.exitInfo;
  }

  async stop(graceMs = 3000) {
    if (!this.running) return this.closeLog();
    this.stopping = true;
    const exitedWithin = (ms) => Promise.race([this.exited.then(() => true), sleep(ms).then(() => false)]);
    this.child.stdin.end(); // polite: server-entry.mjs exits on its own
    if (!(await exitedWithin(graceMs)) && this.running) {
      this.child.kill();
      if (!(await exitedWithin(2000)) && this.running) this.child.kill("SIGKILL");
      await this.exited;
    }
    this.closeLog();
  }

  closeLog() {
    if (this.log) {
      this.log.end();
      this.log = null;
    }
  }
}

function describeExit(info) {
  if (!info) return "unknown";
  if (info.error) return info.error.message;
  if (info.signal) return `signal ${info.signal}`;
  return `exit code ${info.code}`;
}

module.exports = { ServerProcess, pickPort, portIsFree, getHealth, describeExit };
