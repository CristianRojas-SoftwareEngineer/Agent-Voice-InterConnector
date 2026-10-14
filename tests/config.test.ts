// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Donde viven las credenciales: precedencia env var > archivo > defaults,
// tolerancia a archivo ausente/corrupto y merge parcial de updateConfig.
// El state dir se aísla en un temporal (ver helpers) para no tocar el real.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, updateConfig } from "../src/lib/config.js";
import { configPath } from "../src/lib/state-dir.js";
import { isolateStateDir } from "./helpers.js";

let state: ReturnType<typeof isolateStateDir>;

beforeEach(() => {
  state = isolateStateDir();
});

afterEach(() => {
  state.restore();
});

function writeConfigFile(contents: string): void {
  mkdirSync(join(state.dir, "tts-sidecar-narrator"), { recursive: true });
  writeFileSync(configPath(), contents);
}

test("loadConfig sin archivo ni env devuelve los defaults", () => {
  const cfg = loadConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.messageMode, "llm");
  assert.equal(cfg.geminiApiKey, undefined);
  assert.equal(cfg.openRouterApiKey, undefined);
});

test("loadConfig lee los valores del archivo", () => {
  writeConfigFile(
    JSON.stringify({
      enabled: false,
      messageMode: "local",
      geminiApiKey: "clave-archivo",
    }),
  );
  const cfg = loadConfig();
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.messageMode, "local");
  assert.equal(cfg.geminiApiKey, "clave-archivo");
});

test("loadConfig ignora un archivo con JSON inválido y usa defaults", () => {
  writeConfigFile("{corrupto");
  const cfg = loadConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.messageMode, "llm");
});

test("loadConfig normaliza un messageMode desconocido a llm", () => {
  writeConfigFile(JSON.stringify({ messageMode: "otro" }));
  assert.equal(loadConfig().messageMode, "llm");
});

test("loadConfig trata claves vacías o de solo espacios como no configuradas", () => {
  writeConfigFile(
    JSON.stringify({ geminiApiKey: "", openRouterApiKey: "   " }),
  );
  const cfg = loadConfig();
  assert.equal(cfg.geminiApiKey, undefined);
  assert.equal(cfg.openRouterApiKey, undefined);
});

test("las variables de entorno tienen precedencia sobre el archivo", () => {
  writeConfigFile(
    JSON.stringify({
      geminiApiKey: "del-archivo",
      openRouterApiKey: "del-archivo",
    }),
  );
  process.env.GEMINI_API_KEY = "del-entorno";
  const cfg = loadConfig();
  assert.equal(cfg.geminiApiKey, "del-entorno");
  // Sin env var propia, la de OpenRouter sigue viniendo del archivo.
  assert.equal(cfg.openRouterApiKey, "del-archivo");
});

test("una env var vacía no pisa la clave del archivo", () => {
  writeConfigFile(JSON.stringify({ geminiApiKey: "del-archivo" }));
  process.env.GEMINI_API_KEY = "   ";
  assert.equal(loadConfig().geminiApiKey, "del-archivo");
});

test("updateConfig hace merge parcial sin pisar claves no tocadas", () => {
  updateConfig({ geminiApiKey: "clave-uno", messageMode: "local" });
  updateConfig({ enabled: false });
  const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(raw.enabled, false);
  assert.equal(raw.messageMode, "local");
  assert.equal(raw.geminiApiKey, "clave-uno");
});

test("updateConfig crea el state dir si no existe y devuelve la config efectiva", () => {
  const cfg = updateConfig({ enabled: false });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.messageMode, "llm");
});
