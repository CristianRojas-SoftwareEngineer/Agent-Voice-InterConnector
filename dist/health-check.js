// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.

// src/lib/config.ts
import { readFileSync, writeFileSync } from "node:fs";

// src/lib/state-dir.ts
import { homedir, platform } from "node:os";
import { join } from "node:path";
var APP_DIR = "tts-sidecar-narrator";
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
function configPath() {
  return join(stateDir(), "config.json");
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

// src/lib/resolve-cli.ts
import {
  spawn,
  spawnSync
} from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, join as join2 } from "node:path";
var BASE = "ai-voice-interconnector";
function candidateNames() {
  if (process.platform !== "win32") return [BASE];
  const exts = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.trim()).filter(Boolean);
  return [...exts.map((e) => BASE + e.toLowerCase()), BASE];
}
function resolveCli() {
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const names = candidateNames();
  for (const dir of dirs) {
    for (const name of names) {
      const full = join2(dir, name);
      try {
        if (existsSync(full) && statSync(full).isFile()) return full;
      } catch {
      }
    }
  }
  return void 0;
}
function needsShell(cliPath) {
  if (process.platform !== "win32") return false;
  const lower = cliPath.toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}
function quoteForCmd(token) {
  return /[\s"&|<>^%]/.test(token) ? `"${token.replace(/"/g, '""')}"` : token;
}
function buildShellCommand(cli, args) {
  return [cli, ...args].map(quoteForCmd).join(" ");
}
function runCli(cli, args, opts) {
  return needsShell(cli) ? spawnSync(buildShellCommand(cli, args), { ...opts, shell: true }) : spawnSync(cli, args, { ...opts, shell: false });
}
function spawnCli(cli, args, opts) {
  return needsShell(cli) ? spawn(buildShellCommand(cli, args), { ...opts, shell: true }) : spawn(cli, args, { ...opts, shell: false });
}

// src/lib/hook-payload.ts
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

// src/lib/daemon.ts
function isDaemonRunning(cliPath) {
  try {
    const res = runCli(cliPath, ["daemon", "status", "--json"], {
      encoding: "utf8",
      timeout: 1e4,
      windowsHide: true
    });
    if (res.error || typeof res.stdout !== "string" || !res.stdout.trim()) {
      return false;
    }
    const status = JSON.parse(res.stdout);
    return status.daemon === "running";
  } catch {
    return false;
  }
}
function startDaemonDetached(cliPath) {
  try {
    const child = spawnCli(cliPath, ["daemon", "start"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch {
  }
}

// src/lib/health-decision.ts
var NOT_PROVISIONED_MESSAGE = "tts-sidecar-narrator: el entorno de voz no est\xE1 provisionado. Ejecuta ai-voice-interconnector setup para habilitar la narraci\xF3n por voz.";
var DOCTOR_FAILED_MESSAGE = "tts-sidecar-narrator: el diagn\xF3stico del motor (doctor) fall\xF3 y no produjo un veredicto. Ejecuta ai-voice-interconnector doctor --json manualmente.";
var DOCTOR_JSON_HINT = "Ejecuta ai-voice-interconnector doctor --json para el detalle.";
function parseFirstJsonObject(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return void 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        if (trimmed.slice(i + 1).trim() !== "") return void 0;
        try {
          return JSON.parse(trimmed.slice(0, i + 1));
        } catch {
          return void 0;
        }
      }
    }
  }
  return void 0;
}
function isValidReport(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value;
  if (!Array.isArray(record.failed) || !record.failed.every((f) => typeof f === "string")) {
    return false;
  }
  if (!Array.isArray(record.checks)) return false;
  for (const check of record.checks) {
    if (typeof check !== "object" || check === null) return false;
    const c = check;
    if (typeof c.name !== "string" || typeof c.ok !== "boolean" || typeof c.detail !== "string") {
      return false;
    }
  }
  if (record.models !== void 0) {
    if (typeof record.models !== "object" || record.models === null) {
      return false;
    }
    const models = record.models;
    if (models.missing !== void 0 && (!Array.isArray(models.missing) || !models.missing.every((m) => typeof m === "string"))) {
      return false;
    }
  }
  return true;
}
function buildFailedMessage(report) {
  const parts = report.failed.map((name) => {
    const check = report.checks.find((c) => c.name === name);
    if (name === "models_provisioned") {
      const missing = Array.isArray(report.models?.missing) ? report.models.missing.filter((m) => typeof m === "string") : [];
      const missingNote = missing.length > 0 ? ` Modelos sin provisionar: ${missing.join(", ")}.` : "";
      return `${name}: ${NOT_PROVISIONED_MESSAGE}${missingNote}`;
    }
    const detail = check ? check.detail : "";
    return detail ? `${name}: ${detail}.` : `${name}.`;
  });
  return `tts-sidecar-narrator: el diagn\xF3stico del motor reporta chequeos fallidos. ${parts.join(" ")} ${DOCTOR_JSON_HINT}`;
}
function decideHealthAction(input) {
  const { exitCode, report } = input;
  if (isValidReport(report)) {
    if (exitCode === 0 && report.failed.length === 0) {
      return { kind: "healthy" };
    }
    if (exitCode === 1 && report.failed.length > 0) {
      return { kind: "notify", message: buildFailedMessage(report) };
    }
    return { kind: "uncertain" };
  }
  if (exitCode === 1 && typeof report === "object" && report !== null && report.reason === "doctor_failed") {
    return { kind: "notify", message: DOCTOR_FAILED_MESSAGE };
  }
  return { kind: "uncertain" };
}

// src/health-check.ts
function notify(message) {
  process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
}
function ok() {
  process.exit(0);
}
async function main() {
  await readStdin();
  const cfg = loadConfig();
  if (!cfg.enabled) ok();
  const cli = resolveCli();
  if (!cli) {
    notify(
      "tts-sidecar-narrator: AI-Voice-InterConnector no est\xE1 en el PATH. Inst\xE1lalo y ejecuta ai-voice-interconnector setup para habilitar la narraci\xF3n por voz."
    );
  }
  const res = runCli(cli, ["doctor", "--json"], {
    encoding: "utf8",
    timeout: 2e4,
    windowsHide: true
  });
  if (res.error || typeof res.stdout !== "string" || !res.stdout.trim()) ok();
  const report = parseFirstJsonObject(res.stdout);
  const daemonRunning = report?.status === "ok" ? isDaemonRunning(cli) : false;
  const decision = decideHealthAction(report, daemonRunning);
  if (decision.kind === "notify") notify(decision.message);
  if (decision.kind === "warm") startDaemonDetached(cli);
  ok();
}
main().catch(() => process.exit(0));
