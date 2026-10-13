// AURA desktop shell (Electron main process).
// It runs the existing local server (server/index.mjs) with Electron's embedded Node and shows the
// existing React build in a window. No app logic lives here: src/ and server/ are used unchanged.
"use strict";

const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, session, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { ServerProcess, pickPort, describeExit } = require("./server-process.cjs");

const ROOT = path.resolve(__dirname, "..");
const ICON = path.join(__dirname, "assets", "icon.png");
const PREFERRED_PORT = 3017; // a fixed port keeps one origin; 3001 stays free for `npm run dev`
const BG = "#15171c"; // matches --bg in src/App.scss, avoids a white flash

app.setAppUserModelId("com.soubhagya.aura");

// ---- paths -------------------------------------------------------------------------------
const userDir = () => app.getPath("userData"); // %APPDATA%\AURA
const settingsFile = () => path.join(userDir(), "desktop-settings.json");
const logFile = () => path.join(userDir(), "logs", "server.log");

/** Where conversations, memories, meetings and models live. */
function dataDir() {
  if (process.env.AURA_DATA_DIR) return path.resolve(process.env.AURA_DATA_DIR);
  // Unpackaged (npm run desktop): keep using the project's data/ folder so existing data stays.
  return app.isPackaged ? path.join(userDir(), "data") : path.join(ROOT, "data");
}

// ---- Gemini key, encrypted with Windows DPAPI via safeStorage ------------------------------
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(s) {
  fs.mkdirSync(userDir(), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}

function storedKey() {
  const s = readSettings();
  if (s.geminiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(s.geminiKeyEnc, "base64"));
    } catch {
      return "";
    }
  }
  return s.geminiKey || "";
}

function saveKey(key) {
  const s = readSettings();
  delete s.geminiKey;
  delete s.geminiKeyEnc;
  if (key) {
    if (safeStorage.isEncryptionAvailable()) s.geminiKeyEnc = safeStorage.encryptString(key).toString("base64");
    else s.geminiKey = key;
  }
  writeSettings(s);
}

function serverEnv() {
  const env = { ...process.env, AURA_DATA_DIR: dataDir() };
  const key = storedKey();
  // A key saved in the app wins. Without one, the server falls back to GEMINI_API_KEY from
  // the environment or the project's .env (unpackaged only; .env is never packaged).
  if (key) env.GEMINI_API_KEY = key;
  return env;
}

// ---- server lifecycle ------------------------------------------------------------------------
let server = null;
let mainWindow = null;
let booted = false;
let quitting = false;
let serverStopped = false;

const appOrigin = () => (server ? server.url : null);
function isAppUrl(u) {
  const origin = appOrigin();
  if (!origin || !u) return false;
  try {
    return new URL(u).origin === origin;
  } catch {
    return false;
  }
}

async function launchServer() {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const port = await pickPort(attempt === 0 ? PREFERRED_PORT : 0);
    const proc = new ServerProcess({ execPath: process.execPath, root: ROOT, env: serverEnv(), logFile: logFile() }).start(port);
    try {
      const health = await proc.waitUntilReady(90000);
      server = proc;
      watchForCrash(proc);
      return health;
    } catch (e) {
      lastError = e;
      await proc.stop();
      if (!/EADDRINUSE/.test(e.message)) break; // only a port race is worth a second try
    }
  }
  throw lastError;
}

async function stopServer() {
  const old = server;
  server = null;
  if (old) await old.stop();
}

async function restartServer() {
  await stopServer();
  const health = await launchServer();
  if (mainWindow) mainWindow.loadURL(server.url);
  return health;
}

function watchForCrash(proc) {
  proc.exited.then(async (info) => {
    if (quitting || proc.stopping || server !== proc) return;
    server = null;
    const { response } = await dialog.showMessageBox(mainWindow || undefined, {
      type: "error",
      title: "AURA",
      message: "AURA's local server stopped unexpectedly.",
      detail: `${describeExit(info)}\n\n${proc.tail(15)}`.trim(),
      buttons: ["Restart server", "Open log", "Quit"],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 0) await restartServer().catch(showFatal);
    else if (response === 1) shell.openPath(logFile());
    else app.quit();
  });
}

function showFatal(e) {
  dialog.showErrorBox("AURA could not start", `${e?.message || e}\n\nLog: ${logFile()}`);
  app.quit();
}

// ---- windows ---------------------------------------------------------------------------------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "AURA",
    icon: ICON,
    backgroundColor: BG,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(server.url);
}

/** Small window asking for the Gemini API key. Resolves with the key, or null when cancelled. */
function promptForKey({ firstRun }) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 540,
      height: 430,
      resizable: false,
      minimizable: false,
      maximizable: false,
      parent: mainWindow || undefined,
      modal: Boolean(mainWindow),
      title: "Gemini API key",
      icon: ICON,
      backgroundColor: BG,
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, "key-preload.cjs"), contextIsolation: true, sandbox: true },
    });
    win.setMenuBarVisibility(false);
    let result = null;
    const onSave = (e, key) => {
      if (e.sender !== win.webContents) return;
      result = String(key || "").trim() || null;
      win.close();
    };
    const onCancel = (e) => {
      if (e.sender === win.webContents) win.close();
    };
    ipcMain.on("aura-key:save", onSave);
    ipcMain.on("aura-key:cancel", onCancel);
    win.on("closed", () => {
      ipcMain.removeListener("aura-key:save", onSave);
      ipcMain.removeListener("aura-key:cancel", onCancel);
      resolve(result);
    });
    win.loadFile(path.join(__dirname, "key.html"), {
      query: { firstRun: firstRun ? "1" : "0", hasKey: storedKey() ? "1" : "0" },
    });
  });
}

async function changeKey() {
  const key = await promptForKey({ firstRun: false });
  if (!key) return;
  saveKey(key);
  await restartServer().catch(showFatal);
}

// ---- security: mic for AURA only, everything else opens in the default browser ----------------
const ALLOWED_PERMISSIONS = new Set(["media", "clipboard-sanitized-write", "fullscreen"]);

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function setUpSecurity() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details?.requestingUrl || wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isAppUrl(origin));
  app.on("web-contents-created", (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (e, url) => {
      if (!isAppUrl(url)) {
        e.preventDefault();
        openExternal(url);
      }
    });
  });
}

function buildMenu() {
  const template = [
    {
      label: "AURA",
      submenu: [
        { label: "Set Gemini API key…", click: () => changeKey() },
        { label: "Open data folder", click: () => shell.openPath(dataDir()) },
        { label: "Open server log", click: () => shell.openPath(logFile()) },
        { type: "separator" },
        { label: "Restart server", click: () => restartServer().catch(showFatal) },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- app lifecycle ---------------------------------------------------------------------------
async function boot() {
  setUpSecurity();
  buildMenu();
  if (!fs.existsSync(path.join(ROOT, "build", "index.html"))) {
    dialog.showErrorBox(
      "AURA",
      'The web app has not been built yet. Run "npm run desktop" (it builds first) or "npm run build", then start AURA again.'
    );
    app.quit();
    return;
  }
  let health = await launchServer();
  if (!health.hasKey) {
    const key = await promptForKey({ firstRun: true });
    if (key) {
      saveKey(key);
      health = await restartServer();
    }
  }
  createMainWindow();
  booted = true;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  // During first-run setup the key window may be the only window; don't quit when it closes.
  app.on("window-all-closed", () => {
    if (booted) app.quit();
  });
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", (e) => {
    if (serverStopped || !server) return;
    e.preventDefault();
    stopServer().finally(() => {
      serverStopped = true;
      app.quit();
    });
  });
  app.whenReady().then(boot).catch(showFatal);
}
