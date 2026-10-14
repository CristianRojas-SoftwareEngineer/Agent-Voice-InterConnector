// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// El corazón del «costo cero con degradación local»: el orden de fallback y
// que ningún fallo de un proveedor se propague al llamante. Además,
// buildUserContent construye el ÚNICO mensaje `user` con el material del turno.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runChain,
  buildUserContent,
  type GenerationInput,
  type TextProvider,
} from "../src/message/provider-chain.js";
import { SUMMARY_CLOSING } from "../src/message/prompts.js";

const INPUT: GenerationInput = { text: "Último mensaje." };

function provider(
  name: string,
  behavior: () => Promise<string>,
  calls: string[],
): TextProvider {
  return {
    name,
    generate: () => {
      calls.push(name);
      return behavior();
    },
  };
}

test("runChain devuelve el primer texto no vacío sin llamar al resto", async () => {
  const calls: string[] = [];
  const result = await runChain(
    [
      provider("gemini", async () => "Texto de Gemini", calls),
      provider("openrouter", async () => "No debería llamarse", calls),
    ],
    INPUT,
  );
  assert.equal(result, "Texto de Gemini");
  assert.deepEqual(calls, ["gemini"]);
});

test("runChain cae al siguiente nivel ante una excepción (HTTP, timeout)", async () => {
  const calls: string[] = [];
  const result = await runChain(
    [
      provider(
        "gemini",
        async () => {
          throw new Error("Gemini HTTP 429");
        },
        calls,
      ),
      provider("openrouter", async () => "Texto de OpenRouter", calls),
    ],
    INPUT,
  );
  assert.equal(result, "Texto de OpenRouter");
  assert.deepEqual(calls, ["gemini", "openrouter"]);
});

test("runChain trata la respuesta vacía o solo espacios como fallo", async () => {
  const calls: string[] = [];
  const result = await runChain(
    [
      provider("gemini", async () => "   ", calls),
      provider("openrouter", async () => "Respaldo", calls),
    ],
    INPUT,
  );
  assert.equal(result, "Respaldo");
});

test("runChain devuelve undefined si todos los proveedores fallan", async () => {
  const calls: string[] = [];
  const result = await runChain(
    [
      provider(
        "gemini",
        async () => {
          throw new Error("timeout");
        },
        calls,
      ),
      provider(
        "openrouter",
        async () => {
          throw new Error("HTTP 500");
        },
        calls,
      ),
    ],
    INPUT,
  );
  assert.equal(result, undefined);
  assert.deepEqual(calls, ["gemini", "openrouter"]);
});

test("runChain con lista vacía devuelve undefined", async () => {
  assert.equal(await runChain([], INPUT), undefined);
});

test("runChain recorta espacios del texto devuelto", async () => {
  const result = await runChain(
    [provider("gemini", async () => "  con espacios \n", [])],
    INPUT,
  );
  assert.equal(result, "con espacios");
});

// --- buildUserContent (contenido del mensaje único) ---

test("buildUserContent devuelve el contenido del mensaje user con material y cierre", () => {
  const out = buildUserContent({ text: "Creé el componente principal." });
  assert.equal(
    out,
    `Material del turno:\n\nCreé el componente principal.\n\n${SUMMARY_CLOSING}`,
  );
});

test("buildUserContent recorta el material y nunca inyecta historial", () => {
  const out = buildUserContent({ text: "  Hola.  " });
  assert.equal(out, `Material del turno:\n\nHola.\n\n${SUMMARY_CLOSING}`);
});

test("buildUserContent con texto vacío conserva el contenido del mensaje user", () => {
  const out = buildUserContent({ text: "" });
  assert.equal(out, `Material del turno:\n\n\n\n${SUMMARY_CLOSING}`);
});
