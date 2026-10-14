// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// LAUNCHER (fire-and-forget). Corre DENTRO del hook de Claude Code: lee el
// payload, decide si narrar, lo persiste y lanza el worker desanclado. Debe
// salir en <100 ms — nada de red, síntesis ni espera. Sirve a los cinco hooks
// que narran (Stop, SubagentStop, StopFailure, UserPromptSubmit, Notification);
// el worker distingue el evento por hook_event_name.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./lib/config.js";
import { ensureStateDir, payloadPath } from "./lib/state-dir.js";
import { spawnDetached } from "./lib/spawn.js";
import { readStdin, parsePayload } from "./lib/hook-payload.js";

async function main(): Promise<void> {
  const raw = await readStdin();

  // Toggle global: si está desactivado, salir sin efectos.
  const cfg = loadConfig();
  if (!cfg.enabled) return;

  const payload = parsePayload(raw);

  // Persistir el payload para el worker (traspaso launcher → worker).
  ensureStateDir();
  writeFileSync(payloadPath(), JSON.stringify(payload), "utf8");

  // Lanzar el worker desanclado con el mismo Node que ejecuta este launcher.
  const here = dirname(fileURLToPath(import.meta.url));
  const worker = join(here, "narrate-worker.js");
  spawnDetached(process.execPath, [worker]);
}

// El launcher nunca falla la sesión: cualquier error se traga y sale 0.
main()
  .catch(() => {})
  .finally(() => process.exit(0));
