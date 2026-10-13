// Checks the desktop shell's server supervisor against the real server/index.mjs.
// Runs with plain Node (no Electron needed): npm run test:desktop
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { ServerProcess, pickPort, portIsFree, getHealth } = require("../server-process.cjs");

const ROOT = path.resolve(__dirname, "..", "..");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aura-desktop-test-"));
}

function serverEnv(dataDir) {
  // AURA_NO_WARMUP: don't download or load the local models during the test
  return { ...process.env, AURA_DATA_DIR: dataDir, AURA_NO_WARMUP: "1", GEMINI_API_KEY: "test-key-not-real" };
}

test("starts the real server, reports health, keeps data in AURA_DATA_DIR, stops cleanly", async () => {
  const dataDir = tempDir();
  const logFile = path.join(dataDir, "logs", "server.log");
  const port = await pickPort(0);
  const proc = new ServerProcess({ execPath: process.execPath, root: ROOT, env: serverEnv(dataDir), logFile }).start(port);
  try {
    const health = await proc.waitUntilReady(30000);
    assert.equal(health.ok, true);
    assert.equal(health.hasKey, true);
    assert.equal(path.resolve(health.dataDir), path.resolve(dataDir));
    assert.ok(fs.existsSync(path.join(dataDir, "aura.db")), "database created in the data folder");
    assert.equal(proc.url, `http://127.0.0.1:${port}`);
  } finally {
    await proc.stop();
  }
  assert.equal(proc.running, false);
  assert.equal(proc.exitInfo.code, 0, "stopped politely (stdin closed), not killed");
  assert.equal(await getHealth(port, 500), null, "nothing answers after stop");
  assert.ok(await portIsFree(port), "port released");
  assert.match(fs.readFileSync(logFile, "utf8"), /server on http:\/\/localhost/);
});

test("pickPort falls back when the preferred port is taken", async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, "127.0.0.1", r));
  const taken = blocker.address().port;
  try {
    const port = await pickPort(taken);
    assert.notEqual(port, taken);
    assert.ok(await portIsFree(port));
  } finally {
    blocker.close();
  }
});

test("reports an unexpected exit with the server's last output", async () => {
  const dataDir = tempDir();
  const port = await pickPort(0);
  const proc = new ServerProcess({ execPath: process.execPath, root: ROOT, env: serverEnv(dataDir) }).start(port);
  await proc.waitUntilReady(30000);
  proc.child.kill("SIGKILL"); // simulate a crash
  const info = await proc.exited;
  assert.ok(info.code !== 0 || info.signal, "exit recorded");
  assert.equal(proc.running, false);
  assert.match(proc.tail(), /server on/);
});

test("fails fast with a readable error when the server can't start", async () => {
  const fakeRoot = tempDir();
  fs.mkdirSync(path.join(fakeRoot, "server"));
  const script = path.join(fakeRoot, "server", "index.mjs");
  fs.writeFileSync(script, 'console.error("boom: listen EADDRINUSE"); process.exit(3);');
  const proc = new ServerProcess({ execPath: process.execPath, root: fakeRoot, env: process.env, script }).start(await pickPort(0));
  await assert.rejects(proc.waitUntilReady(10000), (e) => /exit code 3/.test(e.message) && /EADDRINUSE/.test(e.message));
});

test("the server exits by itself when the app process is killed (no orphan holding the database)", async () => {
  const dataDir = tempDir();
  const port = await pickPort(0);
  // a stand-in for the Electron main process: starts the server, then gets killed without cleanup
  const parentScript = path.join(dataDir, "parent.cjs");
  fs.writeFileSync(
    parentScript,
    `const { ServerProcess } = require(${JSON.stringify(path.join(__dirname, "..", "server-process.cjs"))});
     const p = new ServerProcess({ execPath: process.execPath, root: ${JSON.stringify(ROOT)}, env: ${JSON.stringify(serverEnv(dataDir))} }).start(${port});
     p.waitUntilReady(30000).then(() => console.log("ready"));
     setInterval(() => {}, 1000);`
  );
  const { spawn } = require("node:child_process");
  const parent = spawn(process.execPath, [parentScript], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    parent.stdout.on("data", (c) => String(c).includes("ready") && resolve());
    parent.once("exit", () => reject(new Error("parent exited early")));
  });
  assert.ok(await getHealth(port), "server up");
  parent.kill("SIGKILL");
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !(await portIsFree(port))) await new Promise((r) => setTimeout(r, 100));
  assert.ok(await portIsFree(port), "server exited after its parent was killed");
});
