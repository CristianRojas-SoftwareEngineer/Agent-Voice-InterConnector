// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Desanclaje y terminación de procesos. El desanclaje es multiplataforma con una
// sola API; la terminación del árbol es la única bifurcación por SO del plugin.
import { spawn, spawnSync } from "node:child_process";

/**
 * Lanza `cmd args` como proceso desanclado: nuevo process group (POSIX) /
 * consola propia (Windows), sin heredar stdio, sin ventana en Windows. El
 * llamante puede salir de inmediato (unref). Devuelve el PID o undefined.
 */
export function spawnDetached(cmd: string, args: string[]): number | undefined {
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

/** ¿El proceso con ese PID sigue vivo? Señal 0 no envía nada, solo comprueba. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: existe pero no tenemos permiso → sigue vivo.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Termina el árbol de procesos de un worker anterior (incluye su `speak` hijo).
 * POSIX: mata el process group completo (posible porque se lanzó con
 * detached: true). Windows: taskkill del árbol. Idempotente y silenciosa: si el
 * PID ya no existe, no hace nada.
 */
export function killWorkerTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    // El PID del worker es también el PGID (lo creó con detached: true).
    process.kill(-pid, "SIGTERM");
  } catch {
    // Ya no existe el grupo, o no tenemos permiso: nada que hacer.
  }
}
