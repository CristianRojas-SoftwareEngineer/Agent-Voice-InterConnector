// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Hook de SessionStart: verifica una sola vez por sesión que la cadena de
// narración está completa (CLI en PATH + modelo cacheado) y, si todo está listo,
// deja el daemon en marcha para que speak --daemon esté caliente durante la
// sesión (elimina el arranque manual tras un reinicio). Ante una carencia, avisa
// al usuario con el campo systemMessage del JSON de salida (único mecanismo de
// aviso portable). Nunca falla la sesión: exit 0 siempre.
import { loadConfig } from "./lib/config.js";
import { resolveCli, runCli } from "./lib/resolve-cli.js";
import { readStdin } from "./lib/hook-payload.js";
import { isDaemonRunning, startDaemonDetached } from "./lib/daemon.js";
import {
  parseFirstJsonObject,
  decideHealthAction,
} from "./lib/health-decision.js";

/** Emite un aviso al usuario y termina la sesión sin bloquearla. */
function notify(message: string): never {
  process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
}

function ok(): never {
  process.exit(0);
}

async function main(): Promise<void> {
  await readStdin(); // drena stdin; el contenido no se usa aquí

  const cfg = loadConfig();
  if (!cfg.enabled) ok();

  const cli = resolveCli();
  if (!cli) {
    notify(
      "tts-sidecar-narrator: AI-Voice-InterConnector no está en el PATH. Instálalo y ejecuta " +
        "ai-voice-interconnector setup para habilitar la narración por voz.",
    );
  }

  // doctor --json imprime el reporte aun cuando falla (exit != 0 si hay FAIL).
  const res = runCli(cli, ["doctor", "--json"], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });

  // Si no se pudo ejecutar el diagnóstico, no molestar (no hay dato accionable).
  if (res.error || typeof res.stdout !== "string" || !res.stdout.trim()) ok();

  // Se toma solo el primer objeto JSON: en caso de fallo el stdout trae el
  // reporte y un {error,…} concatenado que rompería un JSON.parse del total.
  const report = parseFirstJsonObject(res.stdout);

  // El daemon solo se consulta cuando el reporte es "ok" (única rama que puede
  // requerir calentarlo); en los demás casos se evita esa I/O.
  const daemonRunning = report?.status === "ok" ? isDaemonRunning(cli) : false;
  const decision = decideHealthAction(report, daemonRunning);

  // notify: avisa al usuario. warm: deja el daemon caliente para la sesión
  // (fire-and-forget, sin bloquear ni molestar si falla). noop: nada que hacer.
  if (decision.kind === "notify") notify(decision.message);
  if (decision.kind === "warm") startDaemonDetached(cli);

  ok();
}

main().catch(() => process.exit(0));
