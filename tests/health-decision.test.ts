// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Cobertura de la decisión pura del health-check: la función de veredicto y el
// parser del reporte, importados directamente del módulo (sin subprocesos ni
// I/O). Verifica las cuatro ramas de decisión y los casos del parser de forma
// determinista y portable en los tres SO.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideHealthAction,
  parseFirstJsonObject,
  NOT_PROVISIONED_MESSAGE,
} from "../src/lib/health-decision.js";

test("decideHealthAction: sin reporte ⇒ noop", () => {
  assert.deepEqual(decideHealthAction(undefined, false), { kind: "noop" });
});

test("decideHealthAction: status failed ⇒ notify con el mensaje esperado", () => {
  const decision = decideHealthAction({ status: "failed" }, false);
  assert.equal(decision.kind, "notify");
  assert.equal(
    decision.kind === "notify" ? decision.message : "",
    NOT_PROVISIONED_MESSAGE,
  );
});

test("decideHealthAction: status ok + daemon detenido ⇒ warm", () => {
  assert.deepEqual(decideHealthAction({ status: "ok" }, false), {
    kind: "warm",
  });
});

test("decideHealthAction: status ok + daemon en marcha ⇒ noop", () => {
  assert.deepEqual(decideHealthAction({ status: "ok" }, true), {
    kind: "noop",
  });
});

test("parseFirstJsonObject: objeto único válido", () => {
  const report = parseFirstJsonObject(JSON.stringify({ status: "ok" }));
  assert.deepEqual(report, { status: "ok" });
});

test("parseFirstJsonObject: dos objetos concatenados ⇒ toma el primero", () => {
  const text =
    JSON.stringify({ status: "failed", issues: ["x"] }) +
    "\n" +
    JSON.stringify({ error: { code: 4 } });
  assert.deepEqual(parseFirstJsonObject(text), {
    status: "failed",
    issues: ["x"],
  });
});

test("parseFirstJsonObject: texto sin objeto ⇒ undefined", () => {
  assert.equal(parseFirstJsonObject("sin json aquí"), undefined);
});

test("parseFirstJsonObject: fragmento malformado ⇒ undefined", () => {
  assert.equal(parseFirstJsonObject('{"status": '), undefined);
});
