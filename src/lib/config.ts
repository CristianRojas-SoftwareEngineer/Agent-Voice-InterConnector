// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Lee y escribe config.json en el state dir. Las variables de entorno
// GEMINI_API_KEY / OPENROUTER_API_KEY tienen precedencia sobre el archivo.
import { readFileSync, writeFileSync } from "node:fs";
import { configPath, ensureStateDir } from "./state-dir.js";

export type MessageMode = "llm" | "local";

export interface Config {
  enabled: boolean;
  messageMode: MessageMode;
  geminiApiKey?: string;
  openRouterApiKey?: string;
}

const DEFAULTS: Config = {
  enabled: true,
  messageMode: "llm",
};

function readFileConfig(): Partial<Config> {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Partial<Config>;
    }
  } catch {
    // Sin archivo o JSON inválido: se usan defaults.
  }
  return {};
}

/**
 * Config efectiva: defaults ← archivo ← variables de entorno (mayor precedencia).
 * Nunca lanza; ante cualquier problema devuelve al menos los defaults.
 */
export function loadConfig(): Config {
  const file = readFileConfig();
  const cfg: Config = {
    enabled:
      typeof file.enabled === "boolean" ? file.enabled : DEFAULTS.enabled,
    messageMode: file.messageMode === "local" ? "local" : DEFAULTS.messageMode,
    geminiApiKey: emptyToUndef(file.geminiApiKey),
    openRouterApiKey: emptyToUndef(file.openRouterApiKey),
  };

  const envGemini = emptyToUndef(process.env.GEMINI_API_KEY);
  const envOpenRouter = emptyToUndef(process.env.OPENROUTER_API_KEY);
  if (envGemini) cfg.geminiApiKey = envGemini;
  if (envOpenRouter) cfg.openRouterApiKey = envOpenRouter;

  return cfg;
}

/**
 * Mezcla cambios parciales sobre la config del archivo y persiste con permisos
 * restrictivos (0600 en POSIX; no-op efectivo en Windows — ver SECURITY.md,
 * modelo de amenaza). Usado por la skill.
 */
export function updateConfig(patch: Partial<Config>): Config {
  ensureStateDir();
  const current = readFileConfig();
  const merged: Partial<Config> = { ...current, ...patch };
  writeFileSync(configPath(), JSON.stringify(merged, null, 2) + "\n", {
    mode: 0o600,
  });
  return loadConfig();
}

function emptyToUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}
