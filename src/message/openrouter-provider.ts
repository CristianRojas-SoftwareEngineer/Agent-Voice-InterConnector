// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Proveedor de fallback: OpenRouter con modelos :free vía fetch nativo, sin SDK.
// Formato Anthropic Messages (/api/v1/messages), igual que el Orchestrator (§5.4),
// para máxima fidelidad con lo probado. Absorbe los 429 y caídas de Gemini.
import {
  buildUserContent,
  MAX_OUTPUT_TOKENS,
  REQUEST_TIMEOUT_MS,
  type GenerationInput,
  type TextProvider,
} from "./provider-chain.js";
import { SUMMARY_SYSTEM_PROMPT } from "./prompts.js";

const ENDPOINT = "https://openrouter.ai/api/v1/messages";

// Verificar disponibilidad si OpenRouter cambia su catálogo :free.
// Laguna XS 2.1 no emite razonamiento (verificado con key el 2026-07-31): a
// diferencia de Ling 3.0 Flash, no consume el presupuesto de max_tokens en un
// bloque `thinking`, por lo que nunca devuelve texto vacío con el prompt
// anti-invención. Además es 2-3x más rápido en la ruta caliente de voz.
const MODEL = "poolside/laguna-xs-2.1:free";

interface OpenRouterResponse {
  content?: Array<{ type?: string; text?: string }>;
}

export class OpenRouterProvider implements TextProvider {
  readonly name = "openrouter";
  constructor(private readonly apiKey: string) {}

  async generate(input: GenerationInput): Promise<string> {
    if (!this.apiKey) throw new Error("OpenRouter: sin API key");

    const content = buildUserContent(input);
    const body = {
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "x-title": "Agent Voice-InterConnector",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);

    const data = (await res.json()) as OpenRouterResponse;
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    if (!text) throw new Error("OpenRouter devolvió respuesta vacía");
    return text;
  }
}
