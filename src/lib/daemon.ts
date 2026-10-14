// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Consulta y arranque del daemon de AI-Voice-InterConnector vía su CLI pública. El daemon
// mantiene el modelo en memoria: `speak --daemon` lo requiere corriendo (no lo
// arranca solo). El health-check lo levanta de forma desanclada al iniciar sesión.
import { runCli, spawnCli } from "./resolve-cli.js";

/**
 * ¿El daemon está en ejecución? Consulta síncrona y barata (`daemon status
 * --json`), sin cargar el modelo. Devuelve false ante cualquier fallo o duda.
 */
export function isDaemonRunning(cliPath: string): boolean {
  try {
    const res = runCli(cliPath, ["daemon", "status", "--json"], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    if (res.error || typeof res.stdout !== "string" || !res.stdout.trim()) {
      return false;
    }
    const status = JSON.parse(res.stdout) as { daemon?: unknown };
    return status.daemon === "running";
  } catch {
    return false;
  }
}

/**
 * Arranca el daemon de forma desanclada (fire-and-forget): la carga del modelo
 * (~15-20 s) ocurre en segundo plano y no bloquea el hook de SessionStart. No se
 * espera ni se comprueba el resultado; si falla, el health-check no molesta.
 */
export function startDaemonDetached(cliPath: string): void {
  try {
    const child = spawnCli(cliPath, ["daemon", "start"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    // Sin ruido: el arranque del daemon es best-effort.
  }
}
