import fs from "node:fs";
import path from "node:path";
const ALLINONE_HOME = process.env.ALLINONE_HOME || require("os").homedir() + "/ALLINONE-AGENT";


const paperclipHome = process.env.PAPERCLIP_HOME || `${ALLINONE_HOME}\\data\\paperclip`;
const configPath = process.env.PAPERCLIP_CONFIG || path.join(paperclipHome, "instances", "default", "config.json");
const envPath = path.join(path.dirname(configPath), ".env");

process.env.PAPERCLIP_HOME = paperclipHome;
process.env.PAPERCLIP_INSTANCE_ID = process.env.PAPERCLIP_INSTANCE_ID || "default";
process.env.PAPERCLIP_CONFIG = configPath;
process.env.PAPERCLIP_NO_BROWSER = "true";
process.env.PAPERCLIP_OPEN_ON_LISTEN = "false";
process.env.PAPERCLIP_TELEMETRY_DISABLED = "1";
process.env.DO_NOT_TRACK = "1";
process.env.PAPERCLIP_MIGRATION_AUTO_APPLY = "true";
process.env.PAPERCLIP_MIGRATION_PROMPT = "never";

if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const mod = await import("file:///${ALLINONE_HOME}/runtime/paperclip-app/node_modules/@paperclipai/server/dist/index.js");
const started = await mod.startServer();

let shuttingDown = false;
async function handleStop(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await started.shutdown?.(sig);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => { void handleStop("SIGTERM"); });
process.on("SIGINT", () => { void handleStop("SIGINT"); });
