// Gives the API-key window two calls into the main process, and nothing else.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("auraKey", {
  save: (key) => ipcRenderer.send("aura-key:save", String(key || "")),
  cancel: () => ipcRenderer.send("aura-key:cancel"),
});
