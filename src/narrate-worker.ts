// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// WORKER (proceso independiente del hook). Hace todo el trabajo con latencia: instancia única que ESPERA al worker anterior en vez de interrumpirlo (la narración en curso suena completa antes de la siguiente; sin solapamiento), construcción del mensaje y narración vía el CLI. Degrada en silencio; los errores van a worker.log.
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadConfig } from "./lib/config.js";
import {
  ensureStateDir,
  payloadPath,
  workerLogPath,
  workerPidPath,
} from "./lib/state-dir.js";
import { isAlive, killWorkerTree } from "./lib/spawn.js";
import { resolveCli, spawnCli } from "./lib/resolve-cli.js";
import { parsePayload, type HookPayload } from "./lib/hook-payload.js";
import { buildMessage } from "./message/build-message.js";

function log(msg: string): void {
  try {
    appendFileSync(workerLogPath(), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // El logging nunca debe tumbar al worker.
  }
}

// Tiempo máximo que un worker espera a que el anterior termine su narración antes de, como último recurso, interrumpirlo (evita espera indefinida si se cuelga). Cubre varias narraciones encadenadas (~20 s cada una).
const SINGLE_INSTANCE_WAIT_MS = 60_000;

// Intervalo de sondeo mientras hay un dueño vivo: el worker actual duerme y vuelve a comprobar el PID del dueño. 1 s = 1 sondeo/seg, lo bastante frecuente para encadenar sin demora visible y lo bastante espaciado para no burn I/O ni syscalls en un turno con cola larga (25 s ≈ 25 sondeos).
const POLL_INTERVAL_MS = 1_000;

// Pausa de respiración entre narraciones: cuando el worker anterior termina y este toma la plaza, espera este hueco antes de empezar a construir el texto y narrar. Evita que dos locuciones suenen pegadas y se vuelvan confusas, sobre todo en cadenas (UserPromptSubmit + Stop casi simultáneos).
const NARRATION_GAP_MS = 1_000;

/** Suspende el hilo actual de forma síncrona (sin event loop). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Lee el PID dueño actual de la plaza, o NaN si no hay archivo. */
function readOwnerPid(): number {
  try {
    return Number.parseInt(readFileSync(workerPidPath(), "utf8").trim(), 10);
  } catch {
    return NaN;
  }
}

/**
 * Instancia única SIN interrumpir la narración en curso: espera (acotado) a que el worker anterior termine, en vez de matarlo, para que la locución previa suene completa antes de la siguiente y no se solapen. El reclamo de la plaza de PID se hace en bucle: si otro worker la tomó, se espera a él, formando una cadena ordenada y libre de carreras. Si el anterior se cuelga, tras el tope se interrumpe como medida de último recurso.
 */
function takeSingleInstance(): void {
  const deadline = Date.now() + SINGLE_INSTANCE_WAIT_MS;
  while (Date.now() < deadline) {
    const owner = readOwnerPid();
    if (owner === process.pid) return; // soy dueño de la plaza: procedo
    if (Number.isInteger(owner) && isAlive(owner)) {
      sleepSync(POLL_INTERVAL_MS); // dueño vivo: espero a que termine su narración
      continue;
    }
    // Plaza libre (sin dueño o dueño muerto): intento reclamarla.
    try {
      writeFileSync(workerPidPath(), String(process.pid), "utf8");
    } catch {
      // Otro la tomó en paralelo; el bucle reevalúa el dueño.
    }
    sleepSync(POLL_INTERVAL_MS);
  }
  // Tope de seguridad: si no pude sincronizar, interrumpo a cualquier dueño vivo.
  const owner = readOwnerPid();
  if (Number.isInteger(owner) && owner !== process.pid && isAlive(owner)) {
    killWorkerTree(owner);
  }
  writeFileSync(workerPidPath(), String(process.pid), "utf8");
}

function releaseSingleInstance(): void {
  try {
    const owner = Number.parseInt(
      readFileSync(workerPidPath(), "utf8").trim(),
      10,
    );
    if (owner === process.pid) rmSync(workerPidPath(), { force: true });
  } catch {
    // Nada que liberar.
  }
}

function readPayload(): HookPayload {
  try {
    return parsePayload(readFileSync(payloadPath(), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Ejecuta `ai-voice-interconnector speech play --label <label>`: reproduce un anuncio
 * pre-sintetizado, sin modelo ni daemon. Política de fallo: cualquier exit ≠ 0
 * (incluido el `3` de cache miss, anuncio no pre-sintetizado) se registra en worker.log
 * y el turno queda sin audio — sin re-sintetizado ni fallback a `speech say`.
 */
function runPlay(cliPath: string, label: string): Promise<void> {
  return new Promise((resolve) => {
    const args = ["speech", "play", "--label", label];
    const child = spawnCli(cliPath, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (err) => {
      log(`speech play error: ${err.message}`);
      resolve();
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        const hint =
          code === 3
            ? " (locución o voz no disponible; ejecuta narrate-ctl presynth)"
            : "";
        log(`speech play salió con código ${code}${hint}`);
      }
      resolve();
    });
  });
}

/** Ejecuta `ai-voice-interconnector speech say --text <texto> --daemon`. Resuelve al terminar. */
function runSay(cliPath: string, text: string): Promise<void> {
  return new Promise((resolve) => {
    const args = ["speech", "say", "--text", text, "--daemon"];
    const child = spawnCli(cliPath, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (err) => {
      log(`speech say error: ${err.message}`);
      resolve();
    });
    child.on("exit", (code) => {
      if (code !== 0) log(`speech say salió con código ${code}`);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  ensureStateDir();
  takeSingleInstance();

  // Pausa de respiración: asegura un hueco audible entre esta narración y la anterior que acaba de terminar (evita que dos locuciones se encadenen sin pausa y se vuelven confusas). Cuando el worker actual es el único en la plaza, el gap se paga una vez al inicio y no afecta al turno siguiente.
  if (NARRATION_GAP_MS > 0) sleepSync(NARRATION_GAP_MS);

  const cfg = loadConfig();
  if (!cfg.enabled) return;

  const payload = readPayload();

  const request = await buildMessage(payload, cfg);
  if (request.kind === "say" && !request.text) {
    log("mensaje vacío tras la construcción; nada que narrar");
    return;
  }

  const cli = resolveCli();
  if (!cli) {
    log("ai-voice-interconnector no encontrado en PATH; se omite la narración");
    return;
  }

  if (request.kind === "play") await runPlay(cli, request.label);
  else await runSay(cli, request.text);
}

main()
  .catch((err) => log(`worker error: ${err?.message ?? err}`))
  .finally(() => {
    releaseSingleInstance();
    process.exit(0);
  });
