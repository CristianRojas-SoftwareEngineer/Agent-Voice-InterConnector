// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Hook de SessionStart (dist/health-check.js) como subproceso real, con un CLI
// `ai-voice-interconnector` falso en el PATH que responde a `doctor --json`,
// `daemon status --json` y `daemon start`. Fija por contrato el veredicto sobre
// el esquema plano {status, issues[]}: calentar el daemon solo con status "ok",
// avisar al usuario con status "failed", y descartar con seguridad el segundo
// objeto JSON que el motor concatena al reporte cuando falla.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { makeTempDir, removeDir } from "./helpers.js";

const HEALTH = join(process.cwd(), "dist", "health-check.js");

let stateBase: string;

beforeEach(() => {
  stateBase = makeTempDir("narrator-health-");
});

afterEach(() => {
  removeDir(stateBase);
});

/** Env que redirige el state dir al temporal según el SO real del host. */
function healthEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GEMINI_API_KEY;
  delete env.OPENROUTER_API_KEY;
  Object.assign(env, extra);
  if (process.platform === "win32") env.LOCALAPPDATA = stateBase;
  else if (process.platform === "darwin") env.HOME = stateBase;
  else env.XDG_STATE_HOME = stateBase;
  return env;
}

/**
 * Crea un `ai-voice-interconnector` falso en `dir` (shim .cmd en Windows, script
 * sh en Unix, ambos delegando en un impl Node). Despacha por argv: `doctor
 * --json` imprime `doctorJson`; `daemon status --json` imprime
 * {"daemon":"running"} (daemon ya en marcha, forma real del motor), de modo que
 * el hook no arranca el nieto desanclado; cualquier invocación anota su argv en
 * `argv.log`.
 */
function makeFakeCli(dir: string, doctorJson: string): { argvLog: string } {
  const argvLog = join(dir, "argv.log");
  writeFileSync(join(dir, "doctor.json"), doctorJson);
  writeFileSync(
    join(dir, "impl.cjs"),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const argv = process.argv.slice(2);",
      'fs.appendFileSync(path.join(__dirname, "argv.log"), JSON.stringify(argv) + "\\n");',
      'if (argv[0] === "doctor") {',
      '  process.stdout.write(fs.readFileSync(path.join(__dirname, "doctor.json"), "utf8"));',
      "  process.exit(0);",
      "}",
      'if (argv[0] === "daemon" && argv[1] === "status") {',
      '  process.stdout.write(JSON.stringify({ daemon: "running" }));',
      "  process.exit(0);",
      "}",
      "process.exit(0);",
    ].join("\n"),
  );
  if (process.platform === "win32") {
    writeFileSync(
      join(dir, "ai-voice-interconnector.cmd"),
      '@node "%~dp0impl.cjs" %*\r\n@exit /b %errorlevel%\r\n',
    );
  } else {
    const sh = join(dir, "ai-voice-interconnector");
    // ${0%/*} es expansión de parámetros POSIX (built-in del shell): resuelve
    // el dir del shim sin invocar el binario externo `dirname`, que no está en
    // el PATH acotado del test (solo shim + Node). Con `dirname` los runners
    // POSIX de CI fallaban con «dirname: not found».
    writeFileSync(sh, '#!/bin/sh\nexec node "${0%/*}/impl.cjs" "$@"\n');
    chmodSync(sh, 0o755);
  }
  return { argvLog };
}

/** PATH que resuelve el CLI falso y mantiene `node` disponible para el shim. */
function fakeCliEnv(dir: string): Record<string, string> {
  const p = dir + delimiter + dirname(process.execPath);
  return { PATH: p, Path: p };
}

function runHealth(cliDir: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const res = spawnSync(process.execPath, [HEALTH], {
    env: healthEnv(fakeCliEnv(cliDir)),
    input: "",
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function loggedArgvs(argvLog: string): string[][] {
  return readFileSync(argvLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function invoked(argvLog: string, prefix: string[]): boolean {
  return loggedArgvs(argvLog).some((argv) =>
    prefix.every((p, i) => argv[i] === p),
  );
}

test("status ok: no avisa y consulta el daemon para calentarlo", () => {
  const dir = makeTempDir("narrator-health-cli-");
  try {
    const { argvLog } = makeFakeCli(
      dir,
      JSON.stringify({
        status: "ok",
        data_dir: "/x",
        hf_cache: "/y",
        base_status: "ready",
      }),
    );
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    // status "ok": ningún aviso al usuario.
    assert.ok(!res.stdout.includes("systemMessage"));
    // Alcanzó la rama de calentado: consultó el estado del daemon.
    assert.ok(invoked(argvLog, ["doctor", "--json"]));
    assert.ok(invoked(argvLog, ["daemon", "status", "--json"]));
    // El daemon ya está en marcha: el hook no debe arrancarlo (sin nieto).
    assert.ok(!invoked(argvLog, ["daemon", "start"]));
  } finally {
    removeDir(dir);
  }
});

test("status failed: avisa al usuario y no consulta el daemon", () => {
  const dir = makeTempDir("narrator-health-cli-");
  try {
    const { argvLog } = makeFakeCli(
      dir,
      JSON.stringify({
        status: "failed",
        issues: ["Qwen3-TTS model no provisionado"],
      }),
    );
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    // status "failed": aviso al usuario remitiendo a la provisión del motor.
    assert.match(res.stdout, /systemMessage/);
    assert.match(res.stdout, /ai-voice-interconnector setup/);
    // El aviso corta antes de la rama de calentado: no consulta el daemon.
    assert.ok(invoked(argvLog, ["doctor", "--json"]));
    assert.ok(!invoked(argvLog, ["daemon", "status", "--json"]));
  } finally {
    removeDir(dir);
  }
});

test("doble objeto JSON: parsea el primero (reporte) e ignora el {error} concatenado", () => {
  const dir = makeTempDir("narrator-health-cli-");
  try {
    // El motor concatena el reporte y un {error,…} cuando falla; un JSON.parse
    // del total rompería. El aviso confirma que se tomó solo el primer objeto.
    const doctorJson =
      JSON.stringify({ status: "failed", issues: ["modelo ausente"] }) +
      "\n" +
      JSON.stringify({ error: { code: 4, message: "provisión incompleta" } });
    const { argvLog } = makeFakeCli(dir, doctorJson);
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /systemMessage/);
    assert.match(res.stdout, /ai-voice-interconnector setup/);
    assert.ok(invoked(argvLog, ["doctor", "--json"]));
  } finally {
    removeDir(dir);
  }
});
