// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Compila los entry points de src/ a bundles autocontenidos en dist/ con esbuild.
// Sin --check: escribe dist/. Con --check: verifica que dist/ está sincronizado
// con src/ (usado por CI) sin tocar el árbol.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const distDir = join(root, "dist");

const ENTRY_POINTS = [
  "src/narrate-hook.ts",
  "src/narrate-worker.ts",
  "src/health-check.ts",
  "src/narrate-ctl.ts",
];

/** @type {import("esbuild").BuildOptions} */
const baseOptions = {
  entryPoints: ENTRY_POINTS.map((e) => join(root, e)),
  outdir: distDir,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  minify: false,
  sourcemap: false,
  // Bundle autocontenido: no hay dependencias de runtime; solo stdlib de Node
  // (child_process, fs, path, os) y fetch nativo, que esbuild deja como externos
  // implícitos por platform: "node".
  banner: {
    js: "// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.",
  },
};

const isCheck = process.argv.includes("--check");

if (isCheck) {
  const result = await build({ ...baseOptions, write: false });
  let drift = false;
  for (const out of result.outputFiles) {
    const rel = relative(distDir, out.path);
    let current = "";
    try {
      current = await readFile(out.path, "utf8");
    } catch {
      current = "\0__MISSING__";
    }
    if (current !== out.text) {
      drift = true;
      console.error(
        `dist desincronizado: ${rel} difiere de la compilación de src/`,
      );
    }
  }
  if (drift) {
    console.error("\nEjecuta `npm run build` y commitea dist/.");
    process.exit(1);
  }
  console.log("dist/ está sincronizado con src/.");
} else {
  await build(baseOptions);
  console.log(`Compilados ${ENTRY_POINTS.length} bundles en dist/.`);
}
