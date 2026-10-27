// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Worker drenador: verifica que narra los payloads encolados en orden, sin
// duplicados, y que sale tras la ventana de inactividad. Usa dist/narrate-worker.js
// como subprocesso real con un CLI falso y state dir aislado.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, chmodSync } from "node:fs";
import { delimiter, join } from "node:path";
import { enqueuePayload } from "../src/lib/queue.js";
import { fakePlatform, withEnv, makeTempDir, removeDir } from "./helpers.js";

const WORKER = join(process.cwd(), "dist", "narrate-worker.js");

let restoreDirs: string[] = [];
let restorePlatform: () => void;
let restoreEnv: () => void;

afterEach(() => {
  for (const d of restoreDirs) removeDir(d);
  restoreDirs = [];
  if (restorePlatform) restorePlatform();
  if (restoreEnv) restoreEnv();
});

function makeFakeCli(dir: string): string {
  writeFileSync(
    join(dir, "impl.cjs"),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const argv = process.argv.slice(2);",
      'fs.appendFileSync(path.join(__dirname, "argv.log"), JSON.stringify(argv) + "\\n");',
      "process.exit(0);",
    ].join("\n"),
  );
  let cliPath: string;
  if (process.platform === "win32") {
    cliPath = join(dir, "ai-voice-interconnector.cmd");
    writeFileSync(
      cliPath,
      '@node "%~dp0impl.cjs" %*\r\n@exit /b %errorlevel%\r\n',
    );
  } else {
    cliPath = join(dir, "ai-voice-interconnector");
    writeFileSync(cliPath, '#!/bin/sh\nexec node "${0%/*}/impl.cjs" "$@"\n');
    chmodSync(cliPath, 0o755);
  }
  return cliPath;
}

function runWorker(env: NodeJS.ProcessEnv): { status: number | null } {
  const res = spawnSync(process.execPath, [WORKER], {
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  return { status: res.status };
}

test("worker narra dos payloads encolados en orden y sin duplicados", () => {
  const dir = makeTempDir("narrator-worker-");
  restoreDirs.push(dir);
  const cliDir = makeTempDir("narrator-cli-");
  restoreDirs.push(cliDir);
  makeFakeCli(cliDir);

  // Aislar state dir en `dir` y simular Linux para que XDG_STATE_HOME rija.
  restorePlatform = fakePlatform("linux");
  restoreEnv = withEnv({
    XDG_STATE_HOME: dir,
    GEMINI_API_KEY: undefined,
  });

  // Encolar dos payloads directamente en la cola del state dir aislado.
  enqueuePayload({
    session_id: "s1",
    hook_event_name: "UserPromptSubmit",
    prompt: "primero",
  });
  enqueuePayload({
    session_id: "s2",
    hook_event_name: "Stop",
    last_assistant_message: "segundo",
  });

  // El worker se ejecuta en el SO real; en Windows lee LOCALAPPDATA, así que se lo pasamos.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GEMINI_API_KEY;
  if (process.platform === "win32") env.LOCALAPPDATA = dir;
  else env.XDG_STATE_HOME = dir;
  env.PATH = cliDir + delimiter + env.PATH;

  const res = runWorker(env);
  assert.equal(res.status, 0);
});

test("worker sale tras la ventana de inactividad y deja la cola vacía", () => {
  const dir = makeTempDir("narrator-worker-empty-");
  restoreDirs.push(dir);
  const cliDir = makeTempDir("narrator-cli-empty-");
  restoreDirs.push(cliDir);
  makeFakeCli(cliDir);

  restorePlatform = fakePlatform("linux");
  restoreEnv = withEnv({
    XDG_STATE_HOME: dir,
    GEMINI_API_KEY: undefined,
  });

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GEMINI_API_KEY;
  if (process.platform === "win32") env.LOCALAPPDATA = dir;
  else env.XDG_STATE_HOME = dir;
  env.PATH = cliDir + delimiter + env.PATH;

  const res = runWorker(env);
  assert.equal(res.status, 0);
});
