// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Decisión pura del hook de SessionStart: mapea el reporte de `doctor --json` y
// el estado del daemon a un veredicto (avisar / calentar / nada), sin efectos ni
// I/O. Concentra el tipo del reporte, el parser del JSON y el criterio, de modo
// que main() quede como cableado delgado y la lógica sea verificable en aislado.

export interface DoctorReport {
  status: "ok" | "failed";
  issues?: string[];
  data_dir?: string;
  hf_cache?: string;
  base_status?: string;
}

/** Veredicto discriminado del health-check: avisar, calentar el daemon, o nada. */
export type Decision =
  { kind: "notify"; message: string } | { kind: "warm" } | { kind: "noop" };

/** Aviso por entorno de voz no provisionado (status "failed"). Fuente única. */
export const NOT_PROVISIONED_MESSAGE =
  "tts-sidecar-narrator: el entorno de voz no está provisionado. Ejecuta " +
  "ai-voice-interconnector setup para habilitar la narración por voz.";

/**
 * Extrae el primer objeto JSON de nivel superior del texto y lo parsea. En caso
 * de fallo, `doctor --json` concatena dos objetos (el reporte y un {error,…});
 * el recorrido por profundidad de llaves (respetando cadenas y escapes) toma
 * solo el primero e ignora cualquier objeto posterior. Devuelve undefined si no
 * hay un objeto balanceado o el fragmento no parsea.
 */
export function parseFirstJsonObject(text: string): DoctorReport | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
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
        try {
          return JSON.parse(text.slice(start, i + 1)) as DoctorReport;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * Decisión pura y total del health-check. Para cualquier combinación de reporte
 * (o su ausencia) y estado del daemon devuelve exactamente un veredicto, sin
 * ejecutar I/O: sin reporte ⇒ nada; "failed" ⇒ avisar; "ok" + daemon detenido ⇒
 * calentar; resto ⇒ nada.
 */
export function decideHealthAction(
  report: DoctorReport | undefined,
  daemonRunning: boolean,
): Decision {
  if (!report) return { kind: "noop" };
  if (report.status === "failed") {
    return { kind: "notify", message: NOT_PROVISIONED_MESSAGE };
  }
  if (report.status === "ok" && !daemonRunning) return { kind: "warm" };
  return { kind: "noop" };
}
