// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Parseo de `daemon status --json` en isDaemonRunning: fija por contrato la
// forma real que emite el motor —{"daemon":"running"|"stopped"}, una cadena en
// la clave `daemon`, no un booleano `running`— y bloquea la regresión al esquema
// antiguo. Usa un shim `ai-voice-interconnector` falso en disco que imprime un
// payload fijo para `daemon status`, invocado por su ruta directa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDaemonRunning } from "../src/lib/daemon.js";
import { makeTempDir, removeDir } from "./helpers.js";

/**
 * Crea un `ai-voice-interconnector` falso en un temporal que imprime `statusJson`
 * ante `daemon status` y sale 0. Devuelve la ruta al ejecutable (shim .cmd en
 * Windows, script sh en Unix, ambos delegando en un impl Node) y un limpiador.
 */
function makeFakeCli(statusJson: string): {
  cliPath: string;
  cleanup: () => void;
} {
  const dir = makeTempDir("narrator-daemon-cli-");
  writeFileSync(join(dir, "status.json"), statusJson);
  writeFileSync(
    join(dir, "impl.cjs"),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const argv = process.argv.slice(2);",
      'if (argv[0] === "daemon" && argv[1] === "status") {',
      '  process.stdout.write(fs.readFileSync(path.join(__dirname, "status.json"), "utf8"));',
      "  process.exit(0);",
      "}",
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
    // ${0%/*} es expansión de parámetros POSIX (built-in del shell): resuelve
    // el dir del shim sin invocar el binario externo `dirname`, que no está en
    // el PATH acotado del test (solo shim + Node). Con `dirname` los runners
    // POSIX de CI fallaban con «dirname: not found».
    writeFileSync(cliPath, '#!/bin/sh\nexec node "${0%/*}/impl.cjs" "$@"\n');
    chmodSync(cliPath, 0o755);
  }
  return { cliPath, cleanup: () => removeDir(dir) };
}

test('daemon running: {"daemon":"running"} → true', () => {
  const { cliPath, cleanup } = makeFakeCli(
    JSON.stringify({ daemon: "running" }),
  );
  try {
    assert.equal(isDaemonRunning(cliPath), true);
  } finally {
    cleanup();
  }
});

test('daemon stopped: {"daemon":"stopped"} → false', () => {
  const { cliPath, cleanup } = makeFakeCli(
    JSON.stringify({ daemon: "stopped" }),
  );
  try {
    assert.equal(isDaemonRunning(cliPath), false);
  } finally {
    cleanup();
  }
});

test('esquema antiguo {"running":true} no cuenta como corriendo (bloquea regresión)', () => {
  const { cliPath, cleanup } = makeFakeCli(JSON.stringify({ running: true }));
  try {
    assert.equal(isDaemonRunning(cliPath), false);
  } finally {
    cleanup();
  }
});

test("stdout vacío → false", () => {
  const { cliPath, cleanup } = makeFakeCli("");
  try {
    assert.equal(isDaemonRunning(cliPath), false);
  } finally {
    cleanup();
  }
});

test("binario inexistente → false, sin lanzar", () => {
  const dir = makeTempDir("narrator-daemon-none-");
  try {
    assert.equal(isDaemonRunning(join(dir, "no-existe")), false);
  } finally {
    removeDir(dir);
  }
});
