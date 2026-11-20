"use strict";

/**
 * Helper to resolve `ws` module from isolated platform node_modules without duplicating installs.
 */
const path = require("node:path");
const fs = require("node:fs");
const ALLINONE_HOME = process.env.ALLINONE_HOME || require("os").homedir() + "/ALLINONE-AGENT";


function loadWsModule() {
  const candidates = [
    path.resolve(`${ALLINONE_HOME}\\hermes3d\\source\\node_modules\\ws`),
    path.resolve(`${ALLINONE_HOME}\\runtime\\paperclip-app\\node_modules\\ws`),
  ];
  // Also scan pnpm virtual store in runtime/paperclip-app if hoisted path differs
  const pnpmDir = path.resolve(`${ALLINONE_HOME}\\runtime\\paperclip-app\\node_modules\\.pnpm`);
  if (fs.existsSync(pnpmDir)) {
    try {
      for (const entry of fs.readdirSync(pnpmDir)) {
        if (entry.startsWith("ws@")) {
          candidates.push(path.join(pnpmDir, entry, "node_modules", "ws"));
        }
      }
    } catch {}
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return require(c);
    }
  }
  return require("ws");
}

module.exports = { loadWsModule };
