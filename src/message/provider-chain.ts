// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Composición genérica primario → fallback de proveedores de texto. Cualquier
// fallo (sin key, HTTP >= 400 incluido 429, timeout, respuesta vacía) pasa al
// siguiente nivel. La cadena de LLMs puede fallar entera: el modo local (fuera
// de esta cadena, en build-message) garantiza que siempre haya algo que narrar.
import { SUMMARY_CLOSING } from "./prompts.js";

export interface GenerationInput {
  /** Único material del turno: `last_assistant_message` ya acotado por clampHead. */
  text: string;
}

export interface TextProvider {
  readonly name: string;
  /** Devuelve el texto generado; lanza ante cualquier fallo. */
  generate(input: GenerationInput): Promise<string>;
}

/** Timeout por request; una locución que llega tarde ya no es conversacional. */
export const REQUEST_TIMEOUT_MS = 8000;
export const MAX_OUTPUT_TOKENS = 512;

/**
 * Recorre los proveedores en orden y devuelve el primer texto no vacío. Si todos
 * fallan, devuelve undefined (el llamante degrada al constructor local).
 */
export async function runChain(
  providers: TextProvider[],
  input: GenerationInput,
): Promise<string | undefined> {
  for (const provider of providers) {
    try {
      const text = (await provider.generate(input)).trim();
      if (text) return text;
    } catch {
      // Siguiente nivel.
    }
  }
  return undefined;
}

/**
 * Construye el contenido del ÚNICO mensaje `user` para los proveedores LLM:
 * el material del turno más el cierre no presuntivo. Sin historial ni mapeo
 * de roles: el LLM nunca recibe nada que no sea el `last_assistant_message`
 * del payload. Cada proveedor envuelve este string en su propio formato de
 * mensaje.
 */
export function buildUserContent(input: GenerationInput): string {
  const text = (input.text ?? "").trim();
  return `Material del turno:\n\n${text}\n\n${SUMMARY_CLOSING}`;
}
