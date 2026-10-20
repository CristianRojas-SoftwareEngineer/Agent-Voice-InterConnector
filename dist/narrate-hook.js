// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.

// src/narrate-hook.ts
import { writeFileSync as writeFileSync2 } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as join2 } from "node:path";

// src/lib/config.ts
import { readFileSync, writeFileSync } from "node:fs";

// src/lib/state-dir.ts
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
var APP_DIR = "agent-voice-interconnector";
function stateDir() {
  const home = homedir();
  switch (platform()) {
    case "win32": {
      const base = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
      return join(base, APP_DIR);
    }
    case "darwin":
      return join(home, "Library", "Application Support", APP_DIR);
    default: {
      const base = process.env.XDG_STATE_HOME ?? join(home, ".local", "state");
      return join(base, APP_DIR);
    }
  }
}
function ensureStateDir() {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
function configPath() {
  return join(stateDir(), "config.json");
}
function payloadPath() {
  return join(stateDir(), "payload.json");
}

// src/lib/config.ts
var DEFAULTS = {
  enabled: true,
  messageMode: "llm"
};
function readFileConfig() {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
  }
  return {};
}
function loadConfig() {
  const file = readFileConfig();
  const cfg = {
    enabled: typeof file.enabled === "boolean" ? file.enabled : DEFAULTS.enabled,
    messageMode: file.messageMode === "local" ? "local" : DEFAULTS.messageMode,
    geminiApiKey: emptyToUndef(file.geminiApiKey),
    openRouterApiKey: emptyToUndef(file.openRouterApiKey)
  };
  const envGemini = emptyToUndef(process.env.GEMINI_API_KEY);
  const envOpenRouter = emptyToUndef(process.env.OPENROUTER_API_KEY);
  if (envGemini) cfg.geminiApiKey = envGemini;
  if (envOpenRouter) cfg.openRouterApiKey = envOpenRouter;
  return cfg;
}
function emptyToUndef(v) {
  return typeof v === "string" && v.trim() !== "" ? v : void 0;
}

// src/lib/spawn.ts
import { spawn, spawnSync } from "node:child_process";
function spawnDetached(cmd, args) {
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child.pid;
}

// src/lib/hook-payload.ts
function parsePayload(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
  }
  return {};
}
function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    const stdin = process.stdin;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    stdin.on("data", (c) => chunks.push(c));
    stdin.on("end", done);
    stdin.on("error", done);
    stdin.on("close", done);
  });
}

// src/narrate-hook.ts
async function main() {
  const raw = await readStdin();
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  const payload = parsePayload(raw);
  ensureStateDir();
  writeFileSync2(payloadPath(), JSON.stringify(payload), "utf8");
  const here = dirname(fileURLToPath(import.meta.url));
  const worker = join2(here, "narrate-worker.js");
  spawnDetached(process.execPath, [worker]);
}
main().catch(() => {
}).finally(() => process.exit(0));
