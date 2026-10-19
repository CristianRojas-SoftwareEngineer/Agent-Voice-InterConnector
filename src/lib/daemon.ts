// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Consulta y arranque del daemon de AI-Voice-InterConnector vía su CLI pública. El daemon
// mantiene el modelo en memoria: `speech say --daemon` lo requiere corriendo (no
// lo arranca solo). El health-check lo levanta de forma desanclada al iniciar
// sesión. El estado sale de `daemon status --json` (contrato v0.34.0: clave
// `daemon` como cadena, `degraded` y `warm` opcionales, siempre exit 0).
import { runCli, spawnCli } from "./resolve-cli.js";

export interface DaemonStatusResult {
  kind: "running" | "stopped" | "degraded" | "incierto";
  exitCode: number | null;
  degraded?: "unresponsive" | "unregistered" | "orphan_resident";
  warm?: "warming" | "warm" | "warm_failed";
  raw?: unknown;
}

function normalizeWarm(value: unknown): DaemonStatusResult["warm"] {
  return value === "warming" || value === "warm" || value === "warm_failed"
    ? value
    : undefined;
}

function normalizeDegraded(value: unknown): DaemonStatusResult["degraded"] {
  return value === "unresponsive" ||
    value === "unregistered" ||
    value === "orphan_resident"
    ? value
    : undefined;
}

/**
 * Estado del daemon según el contrato v0.34.0. La única rama que significa
 * «en ejecución» es `daemon: "running"` con exit 0; el esquema antiguo
 * `{"running": true}` (booleano), el JSON malformado, la salida vacía, un exit
 * distinto de 0 o un estado desconocido devuelven `incierto` —nunca running—.
 * Conserva exit y JSON crudo para que el health-check pueda diagnosticar sin
 * re-ejecutar el CLI.
 */
export function getDaemonStatus(cliPath: string): DaemonStatusResult {
  let stdout: string | Buffer | undefined;
  let spawnError: unknown;
  let status: number | null;
  try {
    const res = runCli(cliPath, ["daemon", "status", "--json"], {
      encoding: "utf8",
      // Presupuesto de SessionStart: doctor ≤20 s + status ≤5 s = 25 s de
      // subprocesses con ≥5 s de margen bajo el timeout de 30 s del hook.
      timeout: 5000,
      windowsHide: true,
    });
    stdout = res.stdout;
    spawnError = res.error;
    status = typeof res.status === "number" ? res.status : null;
  } catch {
    return { kind: "incierto", exitCode: null };
  }
  const exitCode = status;
  if (spawnError || typeof stdout !== "string" || !stdout.trim()) {
    return { kind: "incierto", exitCode };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: "incierto", exitCode };
  }
  // El contrato fija exit 0 siempre: un exit distinto con JSON es incoherente.
  if (exitCode !== 0) {
    return { kind: "incierto", exitCode, raw: parsed };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "incierto", exitCode, raw: parsed };
  }
  const record = parsed as Record<string, unknown>;
  if (record.daemon !== "running" && record.daemon !== "stopped") {
    return { kind: "incierto", exitCode, raw: parsed };
  }
  if (record.daemon === "running") {
    const warm = normalizeWarm(record.warm);
    return warm
      ? { kind: "running", exitCode, warm, raw: parsed }
      : { kind: "running", exitCode, raw: parsed };
  }
  const degraded = normalizeDegraded(record.degraded);
  if (degraded) {
    return { kind: "degraded", exitCode, degraded, raw: parsed };
  }
  return { kind: "stopped", exitCode, raw: parsed };
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
