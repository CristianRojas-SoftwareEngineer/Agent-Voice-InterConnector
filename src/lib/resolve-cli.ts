// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Resuelve el ejecutable `ai-voice-interconnector` recorriendo el PATH, con las
// extensiones adecuadas por SO. Los instaladores nativos (install.ps1 en
// Windows, install.sh en Linux y macOS) dejan el CLI en el PATH en los tres SO.
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions,
  type SpawnSyncReturns,
} from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

const BASE = "ai-voice-interconnector";

function candidateNames(): string[] {
  if (process.platform !== "win32") return [BASE];
  // En Windows prioriza el .exe (instalador nativo). Los shims .cmd/.bat exigen
  // shell al ejecutarse (ver runCli/spawnCli, única costura de invocación).
  const exts = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT")
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);
  return [...exts.map((e) => BASE + e.toLowerCase()), BASE];
}

/** Ruta absoluta al CLI, o undefined si no está en el PATH. */
export function resolveCli(): string | undefined {
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const names = candidateNames();
  for (const dir of dirs) {
    for (const name of names) {
      const full = join(dir, name);
      try {
        if (existsSync(full) && statSync(full).isFile()) return full;
      } catch {
        // Directorio inaccesible: continuar.
      }
    }
  }
  return undefined;
}

/** ¿La ruta resuelta necesita shell para ejecutarse (shim .cmd/.bat en Windows)? */
export function needsShell(cliPath: string): boolean {
  if (process.platform !== "win32") return false;
  const lower = cliPath.toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}

/**
 * Cita un token para cmd.exe: lo envuelve en comillas dobles solo si contiene
 * espacios o metacaracteres del intérprete (`" & | < > ^ %`), doblando las
 * comillas internas. Función pura, la parte verificable de la política de
 * invocación.
 */
function quoteForCmd(token: string): string {
  return /[\s"&|<>^%]/.test(token) ? `"${token.replace(/"/g, '""')}"` : token;
}

/**
 * Construye la línea de comando para un shim .cmd/.bat de Windows: el ejecutable
 * y sus argumentos citados y unidos por espacios, para pasarla como string único
 * a `shell: true`. Esa es la forma sin DEP0190 —el escapado es nuestro— frente
 * al emparejamiento deprecado array + `shell: true`, que concatena sin escapar.
 */
export function buildShellCommand(cli: string, args: string[]): string {
  return [cli, ...args].map(quoteForCmd).join(" ");
}

/**
 * Invocación síncrona del CLI resuelto. Concentra la política de shell/escape
 * por SO: en Windows los shims .cmd/.bat van por shell con la línea ya citada;
 * en el resto, ejecución directa con el array y sin shell (más seguro, sin
 * quoting). Los llamantes que leen stdout deben pasar `encoding` y ya guardan
 * el tipo (`typeof stdout === "string"`).
 */
export function runCli(
  cli: string,
  args: string[],
  opts: SpawnSyncOptions,
): SpawnSyncReturns<string | Buffer> {
  return needsShell(cli)
    ? spawnSync(buildShellCommand(cli, args), { ...opts, shell: true })
    : spawnSync(cli, args, { ...opts, shell: false });
}

/**
 * Invocación asíncrona del CLI resuelto; devuelve el ChildProcess para adjuntar
 * manejadores o desanclarlo (`unref`). Misma política de shell/escape que runCli.
 */
export function spawnCli(
  cli: string,
  args: string[],
  opts: SpawnOptions,
): ChildProcess {
  return needsShell(cli)
    ? spawn(buildShellCommand(cli, args), { ...opts, shell: true })
    : spawn(cli, args, { ...opts, shell: false });
}
