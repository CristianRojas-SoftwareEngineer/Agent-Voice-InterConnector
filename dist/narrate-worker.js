// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.

// src/narrate-worker.ts
import { appendFileSync, readFileSync as readFileSync2, rmSync, writeFileSync as writeFileSync2 } from "node:fs";

// src/lib/config.ts
import { readFileSync, writeFileSync } from "node:fs";

// src/lib/state-dir.ts
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
var APP_DIR = "claude-voice-interconnector";
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
function workerPidPath() {
  return join(stateDir(), "worker.pid");
}
function payloadPath() {
  return join(stateDir(), "payload.json");
}
function workerLogPath() {
  return join(stateDir(), "worker.log");
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
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
function killWorkerTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
  }
}

// src/lib/resolve-cli.ts
import {
  spawn as spawn2,
  spawnSync as spawnSync2
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
function spawnCli(cli, args, opts) {
  return needsShell(cli) ? spawn2(buildShellCommand(cli, args), { ...opts, shell: true }) : spawn2(cli, args, { ...opts, shell: false });
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

// src/message/prompts.ts
var SUMMARY_SYSTEM_PROMPT = "Eres un desarrollador que habla por voz sintetizada en tiempo real. Narra en primera persona, en una o dos frases breves en espa\xF1ol, \xFAnicamente lo que muestra el material de este turno. Si el turno fue una conversaci\xF3n breve, un saludo o una respuesta sin cambios t\xE9cnicos, n\xE1rralo con naturalidad como tal. No inventes trabajo, comandos, rutas ni identificadores que no aparezcan expl\xEDcitos. Conserva los identificadores y rutas que s\xED est\xE9n presentes cuando aporten claridad. Texto plano, sin markdown ni s\xEDmbolos.";
var SUMMARY_CLOSING = "Cu\xE9ntamelo en voz alta en primera persona, de forma fiel a lo que ocurri\xF3 en este turno.";

// src/message/provider-chain.ts
var REQUEST_TIMEOUT_MS = 8e3;
var MAX_OUTPUT_TOKENS = 512;
async function runChain(providers, input) {
  for (const provider of providers) {
    try {
      const text = (await provider.generate(input)).trim();
      if (text) return text;
    } catch {
    }
  }
  return void 0;
}
function buildUserContent(input) {
  const text = (input.text ?? "").trim();
  return `Material del turno:

${text}

${SUMMARY_CLOSING}`;
}

// src/message/gemini-provider.ts
var MODEL = "gemini-3.1-flash-lite";
var ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
var GeminiProvider = class {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  name = "gemini";
  async generate(input) {
    if (!this.apiKey) throw new Error("Gemini: sin API key");
    const content = buildUserContent(input);
    const body = {
      systemInstruction: {
        parts: [{ text: SUMMARY_SYSTEM_PROMPT }]
      },
      contents: [{ role: "user", parts: [{ text: content }] }],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 }
      }
    };
    const res = await fetch(ENDPOINT(MODEL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini devolvi\xF3 respuesta vac\xEDa");
    return text;
  }
};

// src/message/openrouter-provider.ts
var ENDPOINT2 = "https://openrouter.ai/api/v1/messages";
var MODEL2 = "poolside/laguna-xs-2.1:free";
var OpenRouterProvider = class {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  name = "openrouter";
  async generate(input) {
    if (!this.apiKey) throw new Error("OpenRouter: sin API key");
    const content = buildUserContent(input);
    const body = {
      model: MODEL2,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: "user", content }]
    };
    const res = await fetch(ENDPOINT2, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "x-title": "claude-voice-interconnector"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
    const data = await res.json();
    const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    if (!text) throw new Error("OpenRouter devolvi\xF3 respuesta vac\xEDa");
    return text;
  }
};

// src/message/static-announcements.ts
function announcement(text, label) {
  return { text, label };
}
var ANNOUNCEMENTS = {
  UserPromptSubmit: announcement(
    "Procesando con Claude.",
    "voice-user-prompt-submit"
  ),
  Stop: announcement("El asistente termin\xF3 su turno.", "voice-stop"),
  SubagentStop: announcement(
    "El subagente complet\xF3 su trabajo.",
    "voice-subagent-stop"
  ),
  StopFailure: announcement(
    "Ocurri\xF3 un error durante la ejecuci\xF3n.",
    "voice-stop-failure"
  ),
  Notification: announcement(
    "Claude necesita tu atenci\xF3n.",
    "voice-notification"
  ),
  Default: announcement("Notificaci\xF3n de Claude.", "voice-default")
};

// src/message/sanitize.ts
function toPlainText(input) {
  let t = input ?? "";
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/~~~[\s\S]*?~~~/g, " ");
  t = t.replace(/```[\s\S]*$/g, " ");
  t = t.replace(/~~~[\s\S]*$/g, " ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, " ");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, "");
  t = t.replace(/^\s{0,3}\d+[.)]\s+/gm, "");
  t = t.replace(/[*_~]{1,3}/g, "");
  t = t.replace(/[^\p{L}\p{N}\s.,;:¿?¡!()'"-]/gu, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}
function sanitizeForSpeech(input) {
  const plain = toPlainText(input);
  return plain ? plain.replace(/\s+/g, " ").trim() : "";
}

// src/message/clamp.ts
var LLM_INPUT_MAX_CHARS = 16e3;
var LOCAL_SPEECH_MAX_SENTENCES = 2;
var LOCAL_SPEECH_MAX_CHARS = 500;
var SENTENCE_TERMINATORS = /* @__PURE__ */ new Set([".", "!", "?", "\u2026"]);
function clampHead(text) {
  const t = text ?? "";
  if (t.length <= LLM_INPUT_MAX_CHARS) return t;
  const window = t.slice(0, LLM_INPUT_MAX_CHARS);
  const lastPara = window.lastIndexOf("\n\n");
  if (lastPara > 0) return window.slice(0, lastPara).trimEnd();
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace > 0) return window.slice(0, lastSpace).trimEnd();
  return window;
}
function clampSentences(text, maxChars, maxSentences) {
  const t = (text ?? "").trim();
  if (!t) return "";
  const sentences = splitSentences(t);
  if (t.length <= maxChars && sentences.length <= maxSentences) return t;
  let acc = "";
  let count = 0;
  for (const sentence of sentences) {
    if (count >= maxSentences) break;
    const next = acc ? `${acc} ${sentence}` : sentence;
    if (next.length > maxChars) break;
    acc = next;
    count++;
  }
  if (acc) return acc;
  const window = t.slice(0, maxChars);
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace > 0) return window.slice(0, lastSpace).trimEnd();
  return window;
}
function splitSentences(text) {
  const sentences = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (SENTENCE_TERMINATORS.has(text[i])) {
      if (text[i] === "." && isDigit(text[i - 1]) && isDigit(text[i + 1])) {
        continue;
      }
      let end = i + 1;
      while (end < text.length && SENTENCE_TERMINATORS.has(text[end])) end++;
      const sentence = text.slice(start, end).trim();
      if (sentence) sentences.push(sentence);
      start = end;
      i = end - 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}
function isDigit(char) {
  return char !== void 0 && char >= "0" && char <= "9";
}

// src/message/build-message.ts
async function buildMessage(payload, cfg) {
  const event = payload.hook_event_name;
  if (event === "Notification") {
    return { kind: "play", label: ANNOUNCEMENTS.Notification.label };
  }
  if (event === "UserPromptSubmit") {
    return { kind: "play", label: ANNOUNCEMENTS.UserPromptSubmit.label };
  }
  if (event === "SubagentStop") {
    return { kind: "play", label: ANNOUNCEMENTS.SubagentStop.label };
  }
  if (event === "StopFailure") {
    return { kind: "play", label: ANNOUNCEMENTS.StopFailure.label };
  }
  const raw = payload.last_assistant_message ?? "";
  const primary = sanitizeForSpeech(raw);
  if (primary === "") {
    const fallback = event === "Stop" ? ANNOUNCEMENTS.Stop : ANNOUNCEMENTS.Default;
    return { kind: "play", label: fallback.label };
  }
  if (cfg.messageMode === "llm") {
    const providers = buildProviders(cfg);
    if (providers.length > 0) {
      const input = { text: clampHead(raw) };
      const llm = await runChain(providers, input);
      if (llm) {
        const clean = sanitizeForSpeech(llm);
        if (clean) return { kind: "say", text: clean };
      }
    }
  }
  return {
    kind: "say",
    text: clampSentences(
      primary,
      LOCAL_SPEECH_MAX_CHARS,
      LOCAL_SPEECH_MAX_SENTENCES
    )
  };
}
function buildProviders(cfg) {
  const providers = [];
  if (cfg.geminiApiKey) providers.push(new GeminiProvider(cfg.geminiApiKey));
  if (cfg.openRouterApiKey)
    providers.push(new OpenRouterProvider(cfg.openRouterApiKey));
  return providers;
}

// src/narrate-worker.ts
function log(msg) {
  try {
    appendFileSync(workerLogPath(), `${(/* @__PURE__ */ new Date()).toISOString()} ${msg}
`);
  } catch {
  }
}
var SINGLE_INSTANCE_WAIT_MS = 6e4;
var POLL_INTERVAL_MS = 1e3;
var NARRATION_GAP_MS = 1e3;
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function readOwnerPid() {
  try {
    return Number.parseInt(readFileSync2(workerPidPath(), "utf8").trim(), 10);
  } catch {
    return NaN;
  }
}
function takeSingleInstance() {
  const deadline = Date.now() + SINGLE_INSTANCE_WAIT_MS;
  while (Date.now() < deadline) {
    const owner2 = readOwnerPid();
    if (owner2 === process.pid) return;
    if (Number.isInteger(owner2) && isAlive(owner2)) {
      sleepSync(POLL_INTERVAL_MS);
      continue;
    }
    try {
      writeFileSync2(workerPidPath(), String(process.pid), "utf8");
    } catch {
    }
    sleepSync(POLL_INTERVAL_MS);
  }
  const owner = readOwnerPid();
  if (Number.isInteger(owner) && owner !== process.pid && isAlive(owner)) {
    killWorkerTree(owner);
  }
  writeFileSync2(workerPidPath(), String(process.pid), "utf8");
}
function releaseSingleInstance() {
  try {
    const owner = Number.parseInt(
      readFileSync2(workerPidPath(), "utf8").trim(),
      10
    );
    if (owner === process.pid) rmSync(workerPidPath(), { force: true });
  } catch {
  }
}
function readPayload() {
  try {
    return parsePayload(readFileSync2(payloadPath(), "utf8"));
  } catch {
    return {};
  }
}
function runPlay(cliPath, label) {
  return new Promise((resolve) => {
    const args = ["speech", "play", "--label", label];
    const child = spawnCli(cliPath, args, {
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", (err) => {
      log(`speech play error: ${err.message}`);
      resolve();
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        const hint = code === 3 ? " (anuncio no pre-sintetizado; ejecuta narrate-ctl presynth)" : "";
        log(`speech play sali\xF3 con c\xF3digo ${code}${hint}`);
      }
      resolve();
    });
  });
}
function runSay(cliPath, text) {
  return new Promise((resolve) => {
    const args = ["speech", "say", "--text", text, "--daemon"];
    const child = spawnCli(cliPath, args, {
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", (err) => {
      log(`speech say error: ${err.message}`);
      resolve();
    });
    child.on("exit", (code) => {
      if (code !== 0) log(`speech say sali\xF3 con c\xF3digo ${code}`);
      resolve();
    });
  });
}
async function main() {
  ensureStateDir();
  takeSingleInstance();
  if (NARRATION_GAP_MS > 0) sleepSync(NARRATION_GAP_MS);
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  const payload = readPayload();
  const request = await buildMessage(payload, cfg);
  if (request.kind === "say" && !request.text) {
    log("mensaje vac\xEDo tras la construcci\xF3n; nada que narrar");
    return;
  }
  const cli = resolveCli();
  if (!cli) {
    log("ai-voice-interconnector no encontrado en PATH; se omite la narraci\xF3n");
    return;
  }
  if (request.kind === "play") await runPlay(cli, request.label);
  else await runSay(cli, request.text);
}
main().catch((err) => log(`worker error: ${err?.message ?? err}`)).finally(() => {
  releaseSingleInstance();
  process.exit(0);
});
