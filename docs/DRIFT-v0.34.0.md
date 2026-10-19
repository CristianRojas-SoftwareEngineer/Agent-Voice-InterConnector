# Drift del plugin respecto al motor v0.34.0: guía de remediación

> **Estado (2026-10-19):** diagnóstico y plan para una ejecución futura. Ninguna tarea de código, tests, documentación restante ni `dist/` descrita aquí está implementada por este documento.
>
> **Uso:** guía e índice de trabajo, no autoridad inmutable. Antes de ejecutar la remediación, verificar cada contrato contra el tag del motor que se vaya a consumir y cada consumidor del plugin; si han cambiado, actualizar primero esta guía y las pruebas previstas. La referencia comprobada para este corte es el tag `v0.34.0` de `AI-Voice-InterConnector`. No instalar, reparar ni borrar datos por el solo hecho de leer este plan.

| Dato                    | Referencia                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Motor                   | [`AI-Voice-InterConnector` v0.34.0](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/releases/tag/v0.34.0), tag de 2026-10-19 |
| Plugin                  | `tts-sidecar-narrator` v0.1.0; última sincronización funcional/documental identificada: 2026-09-21, contra motor v0.19.0/v0.20.0                       |
| Alcance de esta edición | Solo `docs/DRIFT-v0.34.0.md`; las rutas citadas en los procedimientos son **destinos futuros**, no archivos modificados ahora                          |
| Regla operativa         | `SessionStart` no bloqueante, timeout del hook 30 s; diagnóstico acotado y arranque desanclado sin observación de su resultado                         |

## Contenidos

1. [Alcance y fuentes](#1-alcance-y-fuentes)
2. [Contratos comprobados](#2-contratos-comprobados)
3. [Hallazgos y decisiones de alcance](#3-hallazgos-y-decisiones-de-alcance)
4. [Flujo futuro de salud y `SessionStart`](#4-flujo-futuro-de-salud-y-sessionstart)
5. [Ejecución futura por fases](#5-ejecución-futura-por-fases)
6. [Validación y cierre de la remediación](#6-validación-y-cierre-de-la-remediación)
7. [Anexo A — Rutas y enlaces](#anexo-a--rutas-y-enlaces)
8. [Anexo B — JSON de referencia](#anexo-b--json-de-referencia)
9. [Anexo C — Salidas relevantes](#anexo-c--salidas-relevantes)

## 1. Alcance y fuentes

El plugin invoca la CLI pública del motor, no sus API internas ni sus pidfiles. La sincronización es diferida: novedades del motor no consumidas por hooks, control, instalación o runbook **no** se convierten automáticamente en funcionalidades nuevas. La actualización de licencia del plugin tampoco constituyó una sincronización funcional. No se fija aquí un número de releases intermedios: no es necesario para decidir qué contrato consume el plugin.

Fuentes primarias del **tag `v0.34.0`** del repositorio hermano (rutas relativas a su raíz):

- `docs/CLI/CONTRACT.md`, en particular §§3, 8, 10–12; `docs/CLI/commands/DOCTOR.md` §§«Las nueve claves», «Los chequeos», «Un solo objeto», «Errores»; `docs/CLI/commands/DAEMON.md` §§«Gestión del ciclo de vida», «Códigos de error».
- `docs/CLI/commands/SPEECH.md` §§`speech list`, `speech play`, `speech remove`, «Errores»; `docs/CLI/commands/CLEANUP.md` §§«Categorías», «Errores»; `docs/CLI/commands/SETUP.md`; `crates/avi-core/src/exit_codes.rs` (`ExitCode`, `REASON_CODES`).
- `README.md`/`docs/DISTRIBUTION.md` para instalación. Los **metadatos** de la release publicada v0.34.0 confirman los assets `install.sh`, `install.ps1`, cuatro binarios y `SHA256SUMS.txt`; no se descargaron ni ejecutaron instaladores y no se comprobó su integridad o funcionamiento.

Fuentes del plugin: `src/health-check.ts`, `src/lib/{health-decision,daemon,resolve-cli}.ts`, `src/{narrate-ctl,narrate-worker}.ts`, `hooks/hooks.json`, `commands/install.md`, `README.md`, `docs/{INTEGRATION,RELEASING}.md`, `tests/{health-decision,health-check,daemon}.test.ts`, `build.mjs`, `test.mjs` y `package.json`. Las referencias son rutas, no números de línea frágiles. `worker.log` del plugin y `data/logs/` del motor son registros distintos.

## 2. Contratos comprobados

### `doctor --json`

Emite **exactamente un reporte JSON**. Sus nueve claves propias son `version`, `target`, `channel`, `install`, `path`, `pending`, `models`, `checks` y `failed`; `schema_version: "5"` lo añade el emisor de la CLI. `checks` contiene `{name, ok, detail}`; `failed` es **`string[]`** de nombres de checks fallidos, vacío si y solo si todos pasan. Los nombres documentados son `install_receipt`, `path_resolves`, `path_duplicates`, `pending_artifacts`, `models_provisioned` y, solo si se compiló con `native-stt`, `onnx_runtime`. El modelo Base figura entre los modelos obligatorios y falta bajo `models.missing`/`models_provisioned`, no bajo un check propio.

| Resultado del proceso                                                                   | Forma de salida                                         | Interpretación                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| Exit 0, reporte válido, `failed: []`                                                    | Reporte, sin `error`                                    | Veredicto sano; solo entonces consultar el daemon.           |
| Exit 1, reporte válido, `failed` no vacío                                               | **El mismo reporte**, sin `reason` ni `error` adicional | Veredicto negativo; no iniciar daemon.                       |
| Exit 1, `reason: "doctor_failed"`                                                       | Objeto de error, no reporte                             | Falló el comando; no atribuirlo a modelos ni iniciar daemon. |
| Timeout, fallo de ejecución, JSON inválido o combinación de código/shape contradictoria | No hay veredicto fiable                                 | Estado incierto; no iniciar daemon.                          |

`doctor` sin `--repair` es solo lectura; `--repair` puede modificar/barrer residuos y **no** debe ejecutarse automáticamente desde `SessionStart`. No hay `status`, `issues`, `data_dir`, `hf_cache` ni `base_status` de nivel superior en el reporte vigente. Un `reason` desconocido en un **error** no autoriza inferir su causa; conservar el código de salida y recomendar diagnóstico explícito. No exigir igualdad exacta de `schema_version` como condición de salud: verificar su forma cuando esté presente y contrastar cambios incompatibles antes de decidir soporte; los campos aditivos no obligan a duplicar el esquema completo en el plugin.

### `daemon status --json` y arranque

`daemon status` termina con **exit 0**, incluso cuando informa `stopped` o `degraded`. `daemon: "running"` significa daemon propio registrado y en servicio; puede traer `pid`, `engine`, `warm` y `warm_error`. El valor JSON de `warm` es `warming`, `warm` o `warm_failed`: «calentando», «listo» y «falló el calentamiento» son descripciones de **texto**, no valores JSON. `daemon: "stopped"` puede llevar `degraded: "unresponsive"|"unregistered"|"orphan_resident"`; `degraded` no implica un PID utilizable por el plugin. `pid`, `engine`, `warm`, `warm_error` y `degraded` son condicionales; `status.path.log` **no** forma parte del contrato. Para investigar un arranque fallido, ejecutar el comando explícitamente y leer su error o los logs del motor.

`daemon start` espera internamente readiness y `/health` **cuando se espera su salida**. Exit 0 significa `started` o `already_running`; entre sus fallos figuran `model_missing` 4, `port_in_use` 6, `daemon_unreachable` 5, `daemon_stop_failed` 16 y `lifecycle_locked` 17 (véase anexo C). Reclama un estado degradado con su propio protocolo, sin que el plugin manipule pidfiles o procesos. El plugin lo lanza hoy con `detached`, `stdio: "ignore"`, `unref()`; por tanto el hook **no observa** su exit, `reason`, log, readiness ni resultado del warmup, y no debe prometerlo. `speech say --daemon` exige daemon activo; no lo inicia.

### Otras superficies consumidas

`setup` provisiona una selección de **cinco** modelos (CustomVoice, Base, dos de traducción y Parakeet); las voces clonadas, incluida la fábrica `default`, requieren Base. `speech synthesize` devuelve exit 6 por `label_exists` cuando ya existe el anuncio; `presynth` del plugin lo considera éxito sin reescribirlo, y `presynth --force` sirve si cambió su texto. `speech play` puede fallar con `speech_not_found` 3 o `io_error` 1; este entero por sí solo **no demuestra** sidecar corrupto. Si el error de `speech list`/`speech play` identifica un sidecar corrupto, `speech remove --label <etiqueta> [--voice <voz>]` permite retirar **esa** locución sin deserializar su sidecar. No usar `cleanup --all`: incluye configuración, logs, estado y otras categorías; `cleanup --synthetic-speech` también borra toda la raíz de locuciones. Tampoco borrar manualmente pidfiles o procesos por PID.

Las seis superficies publicadas de integración del motor en `CONTRACT.md` §12 son `speech say`, `speech synthesize`, `speech play`, `doctor`, `daemon status` y `daemon start`. `daemon stop`, `self install`, `self uninstall`, `cleanup`, `dub` y `transcribe` no se incorporan al runtime del plugin por esta sincronización.

## 3. Hallazgos y decisiones de alcance

| ID    | Superficie afectada                                                   | Evidencia y efecto                                                                                                                                                                                                        | Trabajo futuro                                                                                                                                      |
| ----- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1    | `src/lib/health-decision.ts`, `src/health-check.ts`, tests de salud   | Se decide por `report.status`, ausente en v0.34.0: no se avisa ni se consulta el daemon con un reporte real. Los tests usan `status`/`issues` anteriores.                                                                 | Consumir exit + `checks`/`failed` válidos y diferenciar causas; ver §4 y fase 1.                                                                    |
| A2    | `docs/RELEASING.md`                                                   | Dos comprobaciones PowerShell leen `.running`, booleano inexistente en `daemon status`. `src/lib/daemon.ts` **ya** lee `.daemon` correctamente.                                                                           | Corregir solo el runbook; no revertir el parser vigente.                                                                                            |
| A3    | Comentario de `src/lib/daemon.ts`                                     | Dice `speak --daemon`, mientras el código invoca `speech say/synthesize --daemon`.                                                                                                                                        | Corregir el comentario, sin cambio de invocación.                                                                                                   |
| A4    | Límites/labels y salidas de `presynth`                                | Límites de texto, slugs y `label_exists` siguen aplicando.                                                                                                                                                                | Sin cambio funcional; conservar sus pruebas.                                                                                                        |
| A5    | `SessionStart`, `src/lib/daemon.ts`, tests                            | `start` desanclado no informa del resultado; `isDaemonRunning` convierte error de `status` en «detenido», habilitando un arranque ante incertidumbre.                                                                     | Distinguir running, stopped limpio, degraded e incierto; arranque único solo tras stopped limpio; avisar de cómo diagnosticar después, sin esperar. |
| A6    | `schema_version`                                                      | El plugin no lo consulta; no hay evidencia de ruptura solo por ese hecho. Las versiones del esquema CLI y del protocolo daemon son independientes aunque ambas sean `"5"` en este corte.                                  | No crear una tarea autónoma de warning/hard-fail por versión; registrar la versión del motor verificada y validar los campos efectivamente usados.  |
| B1    | `commands/install.md`, `docs/RELEASING.md`                            | Los tres instaladores `raw.githubusercontent.com/.../main/install-*` citados no existen en este tag.                                                                                                                      | Apuntar a `install.sh`/`install.ps1` publicados; pin al tag comprobado para el smoke del runbook.                                                   |
| B2/B3 | `commands/install.md`, `docs/INTEGRATION.md`                          | Describen un solo modelo y `doctor.status`/`issues`; omiten los cinco modelos y Base.                                                                                                                                     | Corregir setup, diagnóstico y voces desde contratos actuales, sin afirmar que un problema de autenticación HF es inherente a todos los modelos.     |
| B4    | `commands/install.md`                                                 | Usa `synthetic-speech/` como directorio; el motor guarda `speech/<voz>/<etiqueta>.wav`.                                                                                                                                   | Corregir ruta; no añadir mapping de `lifecycle_locked` al worker: no consume operaciones de ciclo de vida.                                          |
| C1    | `docs/INTEGRATION.md`, `README.md`, `docs/RELEASING.md`               | Enlaces a `docs/CLAUDE-CODE-INTEGRATION.md` del motor, ausente en el tag.                                                                                                                                                 | Sustituir por la sección pertinente de `docs/CLI/CONTRACT.md`/`USAGE.md` según el texto del enlace.                                                 |
| C2    | `docs/INTEGRATION.md`, `README.md`, `docs/RELEASING.md`               | Integración habla de cuatro superficies; runbook exige versión verificada en README/INTEGRATION, pero no se declara allí.                                                                                                 | Reflejar seis superficies, declarar versión **verificada** por separado y dejar `$MOTOR_VERSION = "vX.Y.Z"` parametrizable.                         |
| D1    | `hooks/hooks.json`, `src/health-check.ts`, `src/lib/daemon.ts`        | `doctor` 20 s + `status` 10 s = 30 s, sin margen para el hook. No hay base para extrapolar tiempos de síntesis a `status`.                                                                                                | Presupuesto agregado **<30 s** con margen; mantener consulta acotada, sin sondeo largo ni esperar arranque.                                         |
| D2    | Parser/comentarios en `health-decision.ts`, `health-check.ts` y tests | `parseFirstJsonObject` admite silenciosamente un segundo objeto; comentarios/tests afirman falsamente que `doctor` lo concatena.                                                                                          | Sustituir por parseo de un objeto completo y validación mínima; un segundo objeto pasa a ser salida inválida, no un veredicto.                      |
| D3    | `docs/INTEGRATION.md`                                                 | `worker.log` es del plugin; los logs del motor usan otra raíz y token de proceso.                                                                                                                                         | Documentar ambos, patrón del motor `data/logs/<familia>_<token>_<ms>.log` y `RUST_LOG` sin prometer una ruta desde `status`.                        |
| D4    | `src/narrate-ctl.ts`, `src/narrate-worker.ts`, troubleshooting        | `say` hereda stderr y devuelve código; `presynth` hereda stderr, traduce 5/4 y condensa fallos a 1; worker usa `stdio: ignore` y solo registra código de `play`/`say`. Ninguno obtiene `reason` JSON ni ruta del sidecar. | No inferir corrupción ni prescribir borrado por exit 1. Documentar diagnóstico manual dirigido y probar que no se recomienda `cleanup --all`.       |

Fuera de alcance funcional: claves nuevas de `doctor.pending`, recibo de `self install`, pidfile, variables de caché no leídas, progress de comandos ajenos y validación `empty_audio` de `dub`/`transcribe`. `warm` sí se considera en el flujo porque `SessionStart` consulta `status`, pero no se introduce supervisor, polling prolongado ni lectura de PID/engine. No pasar identificadores A1–D4 como nombres de símbolos de producción.

## 4. Flujo futuro de salud y `SessionStart`

**Decisión de diseño para esta remediación futura:** preservar la política no bloqueante. Los avisos proceden de resultados observados de `doctor`/`status`; el arranque automático no genera aviso de éxito o fallo, porque su salida queda desanclada. Esta política debe implementarse en la decisión pura y el cableado del hook, sin ampliar la superficie pública del motor.

### Entrada de `doctor` → acción

Validar un **único** objeto JSON completo y un shape mínimo: `failed` array de cadenas, `checks` array de `{name: string, ok: boolean, detail: string}`; comprobar que los nombres fallidos y `ok` son coherentes. Tipar solo los campos que se usan: `models.missing` puede aportar contexto si es array de cadenas. No leer `pending`, `install` ni `path` solo para reconstruir un diagnóstico que `checks.detail` ya ofrece. No recortar un primer objeto de una salida inválida. Los checks desconocidos se pueden nombrar sin asignarles un remedio inventado.

| Exit de `doctor` / entrada                                                                                                     | Acción y aviso observable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Consulta `status` |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 0 + reporte válido + `failed: []`                                                                                              | Sano **para los checks de doctor**; no equivale a warmup completo.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Sí.               |
| 1 + reporte válido + `failed` no vacío                                                                                         | Avisar por `systemMessage`, sin iniciar: `models_provisioned` → `setup` y, si está disponible, lista `models.missing`; `pending_artifacts` → mostrar `detail` y sugerir `doctor` explícito, `doctor --repair` solo tras revisar su alcance; `install_receipt`/`path_resolves`/`path_duplicates` → revisar instalación y `PATH`; `onnx_runtime` → revisar runtime STT; cualquier otro check → mostrar nombre/detalle y `doctor --json`. Si fallan varios, no ocultar ninguno ni ofrecer `setup` como solución universal. | No.               |
| 1 + objeto de error (`doctor_failed` u otro `reason`)                                                                          | Avisar de que falló el diagnóstico y sugerir repetir `doctor --json`; no confundir con el veredicto negativo. No mostrar texto arbitrario del motor sin acotarlo.                                                                                                                                                                                                                                                                                                                                                       | No.               |
| 0 + `failed` no vacío, 1 + `failed: []`, otro exit, shape incoherente, JSON inválido/concatenado, timeout o error de ejecución | Estado incierto; mensaje acotado que indique cómo ejecutar `doctor --json` cuando exista información fiable; si ni siquiera hubo salida, salida silenciosa es aceptable. **Nunca** iniciar a partir de ese dato.                                                                                                                                                                                                                                                                                                        | No.               |

El hook conserva exit 0 y no ejecuta reparaciones. La falta de CLI mantiene el aviso específico existente. Los mensajes deben ser breves, no imprimir rutas o contenidos no confiables sin límite y no afirmar causas que `failed` no sustenta.

### Entrada de `daemon status` → acción

Solo después del primer renglón de doctor. Preservar del resultado de `runCli` el exit y la distinción entre fallo y `daemon: "stopped"`; no reducir todo a un booleano «no running». `degraded` no autoriza borrados ni reintentos ciegos.

| Resultado de `status`                                                                                                 | Acción del hook                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exit 0, JSON válido, `daemon: "running"`, `warm: "warm"` o ausente                                                    | No iniciar; `running` confirma servicio, no garantiza estado futuro.                                                                                                                             |
| Exit 0, `daemon: "running"`, `warm: "warming"`                                                                        | No iniciar ni esperar; calentamiento en curso, aviso breve opcional sin prometer cuándo termina.                                                                                                 |
| Exit 0, `daemon: "running"`, `warm: "warm_failed"`                                                                    | No iniciar otra instancia; avisar del fallo observado y solicitar `daemon status --json`/logs del motor.                                                                                         |
| Exit 0, `daemon: "stopped"`, sin `degraded`                                                                           | Solicitar **una** invocación desanclada de `daemon start`, sin esperar ni sondear después. No afirmar que arrancó.                                                                               |
| Exit 0, `daemon: "stopped"`, `degraded` reconocido                                                                    | Avisar del residual observado y remitir a diagnóstico explícito (`daemon status --json`, después `daemon start` manual si corresponde); **no** iniciar ni limpiar automáticamente desde el hook. |
| Fallo/timeout/exit distinto de 0, JSON inválido, `daemon` desconocido, `degraded` inesperado o campos contradictorios | Estado incierto: no iniciar. Avisar cuando haya dato diagnóstico fiable; mantener exit 0 del hook.                                                                                               |

El motor puede reclamar un residual durante un `start` **explícito**; el hook decide no hacerlo automáticamente para no ocultar un estado degradado. `warm_error` es dato condicional, no requiere inventar un `reason` de `status`. La ausencia de `warm` no es un fallo por sí sola.

### Presupuesto y reversión

`hooks/hooks.json` permite 30 s para **todo** `SessionStart`, incluido arranque del proceso Node, drenaje de stdin, resolución de CLI y salida. Proponer `doctor` máximo **20 s** y `daemon status` máximo **5 s**, solo si procede: suma de subprocesses **25 s**, dejando **5 s** de margen para el resto; comprobarlo con una prueba de demora controlada y reducir plazos si el overhead real agota ese margen. `daemon start` se invoca una sola vez de forma desanclada sin esperar su exit ni el warmup. No elevar `status` a 30 s, no usar tiempos de síntesis para justificarlo y no introducir polling/retry en `SessionStart`.

Si la implementación futura no supera las pruebas, revertir solo el cambio del hook y su decisión a la conducta anterior **temporalmente**, manteniendo avisos y arranque best-effort conocidos y declarando que el contrato viejo sigue roto frente a v0.34.0; no revertir mediante manipulación de PIDs, pidfiles, caché ni datos del motor. No publicar el plugin como compatible con v0.34.0 mientras siga fallando esta fase.

## 5. Ejecución futura por fases

Las fases se refieren a una ejecución posterior que sí modifique los archivos nombrados. Dentro de cada fase, primero reproducir el comportamiento en tests cuando exista framework; luego hacer el cambio mínimo y verificar la salida indicada. Las fases documentales independientes pueden avanzar en paralelo con la implementación tras fijar los contratos, pero se integran antes del cierre.

### Fase 0 — Congelar contrato y fixtures

**Entrada:** tag objetivo y consumidores identificados. **Acciones:** volver a contrastar `DOCTOR.md`, `DAEMON.md`, `SPEECH.md`, `CLEANUP.md`, `CONTRACT.md` y `exit_codes.rs` del tag; preparar en `tests/health-decision.test.ts`, `tests/health-check.test.ts` y `tests/daemon.test.ts` fixtures mínimos con `failed: string[]`, exit 0/1 y estados reales. Mantener tests de regresión para `daemon` cadena en vez de `running` booleano. Distinguir ejemplos ilustrativos del anexo B de fixtures completos del motor. **Salida:** tests nuevos reproducen el fallo actual; tabla del anexo C sigue concordando con el tag.

### Fase 1 — Diagnóstico y hook (A1, A5, D1, D2)

1. `src/lib/health-decision.ts`: reemplazar `DoctorReport` obsoleto por el shape mínimo de §4 y decidir según exit **más** reporte válido. Eliminar parser que trunca la salida y corregir comentarios sobre doble objeto; conservar un mensaje para falta de provisión solo cuando `models_provisioned` falla. Si se reutiliza el nombre `DoctorReport`, no imponer renombrado cosmético. Validar en `tests/health-decision.test.ts`: sano, fallos individuales y múltiples, check desconocido, envelope de error, exit/shape incoherentes, JSON malformado/concatenado y ausencia de reporte.
2. `src/health-check.ts`: preservar el exit de `runCli` (`res.status`), comprobar `res.error`/stdout, llamar la decisión con esos datos, consultar `status` solo tras diagnóstico sano y emitir `systemMessage` verificable; no perder el caso exit 1 válido. Conservar salida 0 incluso en error; actualizar comentarios. `tests/health-check.test.ts`: shim configurable con exit 1 y reporte real, `doctor_failed`, JSON inválido, sin CLI, daemon en marcha, detenido, degradado, incierto y warmup fallido; observar una sola petición de `start` cuando corresponde sin esperar su resultado ni usar sleeps frágiles.
3. `src/lib/daemon.ts`: adaptar `isDaemonRunning` o sustituirlo por un resultado discriminado que conserve «running / stopped / degraded / incierto» con exit y JSON; dejar `startDaemonDetached` fire-and-forget, sin inventar captura de `reason` o log. Corregir comentario `speak --daemon`. `tests/daemon.test.ts`: `running` con `warming`/`warm`/`warm_failed`, stopped limpio, tres `degraded`, error/timeout, JSON inválido y estado desconocido. Implementar la política exacta de §4; no leer `pid` para limpiar.
4. Ajustar presupuesto en `src/health-check.ts`/`src/lib/daemon.ts` dentro del timeout de `hooks/hooks.json` (30 s) y probar que el hook sale antes del límite incluso con respuesta lenta. No cambiar el límite del hook ni esperar `daemon start`.

**Salida:** tests de salud/daemon pasan contra el nuevo flujo; `SessionStart` no bloquea y no afirma resultado no observado. Si un test requiere que el nieto escriba un log, verificarlo de forma acotada y no convertirlo en polling de warmup de producción.

### Fase 2 — CLI y documentación independientes (A2, A3, B1–B4, C1–C2, D3–D4)

- `commands/install.md`: sustituir tres URL de instaladores; actualizar Pasos 0 y 6 para `checks`/`failed` y exit 0/1, Paso 2 para cinco modelos y Base, y la mención de `synthetic-speech/` por `speech/`. Mantener `setup` idempotente; evitar prometer siempre acceso gated o una única descarga. Revisar los pasos de `presynth` contra `src/narrate-ctl.ts` (exit final 1 ante fallo, 5/4 son códigos **internos** del motor impresos por evento) y no inferir sidecar corrupto de ese exit.
- `docs/INTEGRATION.md`: actualizar doctor, modelo Base, seis superficies, versión v0.34.0 **verificada como corte** y troubleshooting separado para `worker.log` del plugin y `data/logs/<familia>_<token>_<ms>.log` del motor; explicar `RUST_LOG` sin asociar log a `status.path.log`. No convertir `doctor --repair` o `cleanup --all` en instrucción automática.
- `docs/RELEASING.md`: conservar `$MOTOR_VERSION = "vX.Y.Z"` y comparar el output de `ai-voice-interconnector version` con esa variable (normalizando solo el prefijo `v`); corregir `doctor.status`/`issues` y los dos accesos PowerShell `.running` a `.daemon -eq "running"`. Usar asset de instalación de la **release identificada por `$MOTOR_VERSION`** en el smoke, no `latest` que puede avanzar entre comprobación e instalación. Antes de instalar, comprobar que el asset existe; verificar después la versión real y la salud con `failed`/exit. Mantener el smoke desde clon limpio y sin ejecutar instaladores durante esta edición.
- `README.md`, `docs/INTEGRATION.md`, `docs/RELEASING.md`: reemplazar enlaces al documento del motor retirado por destino vigente según la intención del enlace (`CONTRACT.md` §12 o `USAGE.md`), declarar el corte verificado en README/INTEGRATION y cotejar las comprobaciones del runbook. `src/lib/resolve-cli.ts`: corregir el comentario que aún cita `install-windows.ps1`, `install-linux.sh` e `install-macos.sh` por los assets `install.ps1`/`install.sh`; no cambiar la búsqueda de ejecutable sin evidencia.
- `src/narrate-ctl.ts` y `src/narrate-worker.ts`: **sin tarea nueva de mapeo de `lifecycle_locked` ni `io_error` genérico**: `say` hereda stderr y devuelve exit, `presynth` lo hereda pero sintetiza exit final, worker descarta stderr/stdout y registra solo código. Si se desea un mensaje específico por sidecar, diseñar primero una ruta de datos fiable que identifique archivo/etiqueta (no existe hoy); aquí basta documentar que, tras identificar la locución con el diagnóstico manual del motor, el remedio local es `speech remove --label` y luego `presynth` si procede. Verificar mediante revisión/test existente que ningún mensaje recomienda `cleanup --all` por exit 1.

**Salida:** rutas y enlaces resuelven contra el tag/release, docs reflejan las salidas efectivas y no hay consejos de borrado masivo. Las correcciones puramente documentales pueden aplicarse antes de la fase 1; solo requieren el contrato de fase 0.

### Fase 3 — Integración, limpieza y reversión

1. Tras cualquier cambio de `src/`, ejecutar `npm run typecheck` y **`npm run build` antes de `npm test`**: `test.mjs` recompila `tests/.build/`, pero el E2E ejecuta `dist/health-check.js` existente. Después correr `npm run lint`, `npm run format:check` y `npm run check-dist` (solo compara `dist/`); no usar `lint:fix` ni `format` sobre todo el repo como limpieza indiscriminada.
2. Barrer `status`/`issues` de `doctor`, mención al doble objeto, `.running` en PowerShell, URLs anteriores, `synthetic-speech/` como directorio y consejos `cleanup --all` para sidecar en `src/`, tests y docs. Retirar **solo** imports/exports, parsers, fixtures y comentarios que el cambio dejó huérfanos; no conservar compatibilidad con reporte antiguo sin consumidores comprobados. No repetir órdenes de eliminar símbolos ya retirados en fase 1 ni escribir IDs A1–D4 en código fuente.
3. Revisar diff de código/tests/docs/`dist/` generado: cada línea debe responder a un hallazgo y el bundle versionado debe coincidir con el fuente. Si falla esta fase, revertir únicamente el consumidor afectado y su `dist/` asociado; no usar `cleanup`, `self uninstall`, `doctor --repair` ni borrado de datos como rollback del plugin.

**Salida:** checks locales verdes, sin artefactos no solicitados ni símbolos huérfanos. `dist/` es un resultado previsto de la **remediación futura**, no de esta edición documental.

## 6. Validación y cierre de la remediación

Orden de dependencia: **contrato/fixtures (fase 0) → salud/hook (fase 1) y superficies documentales independientes (fase 2) → build, tests y limpieza (fase 3) → smoke publicado**. No hay obligación de secuenciar tareas documentales independientes entre sí. Un fallo impide declarar sincronización completa; no exige borrar datos para «empezar de cero».

Checklist para quien implemente más adelante:

- [ ] `doctor` exit 0/1 con reporte válido, error `doctor_failed`, payload inválido y checks múltiples producen las decisiones de §4; no se consulta el daemon si el diagnóstico es negativo o incierto.
- [ ] `status` stopped limpio solicita un solo start; degraded/error/incierto no dispara otro. Running `warming` no bloquea; `warm_failed` avisa sin reiniciar. El hook sale 0 y dentro de 30 s con margen medido.
- [ ] Los tests unitarios y E2E simulan las combinaciones de exit/JSON reales; ningún test asume segundo objeto ni espera resultado del proceso desanclado.
- [ ] `npm run typecheck`, `npm run build`, `npm test`, `npm run lint`, `npm run format:check` y `npm run check-dist` terminan en verde, en ese orden pertinente para `dist/`.
- [ ] Los instaladores del tag elegido figuran como **assets publicados**; la instalación de smoke usa ese tag, `version` coincide y el diagnóstico `doctor` se valida por exit + `failed`, no por `status`. El smoke reproduce una condición de fallo segura (por ejemplo, CLI fuera del `PATH` del hook en entorno aislado) y comprueba el aviso sin tocar datos del motor.
- [ ] Smoke audible del plugin desde clon limpio contra binario **publicado**: cinco hooks de narración en modo `local`, `Stop` en modo `llm` si hay claves configuradas, `narrate-ctl status`, `say` y `presynth`/`speech play`, más `SessionStart` con y sin motor. No afirmar que se ejecutó mientras no se haya hecho.
- [ ] README, instalación, integración y runbook concuerdan con el contrato; versión verificada declarada sin congelar `$MOTOR_VERSION`; enlaces comprobados; `worker.log` y logs del motor diferenciados. No quedan consejos de `cleanup --all` para una locución.
- [ ] Auditoría final de imports/exports, parser, comentarios, fixtures, referencias cruzadas y soporte obsoleto sin consumidores; diff acotado y `dist/` sincronizado. No hacer tag/publicación hasta completar estas comprobaciones.

**Verificación de esta edición documental (distinta del checklist futuro):** cotejar índice, tablas, ejemplos y referencias con las fuentes del §1 y revisar que solo cambió `docs/DRIFT-v0.34.0.md`; el archivo continúa sin seguimiento en Git hasta que el usuario decida incorporarlo. La consulta de metadatos de release no equivale al smoke, que queda **pendiente**.

## Anexo A — Rutas y enlaces

| Uso futuro              | Antiguo en el plugin                                                      | Referencia vigente para v0.34.0                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instalación Linux/macOS | `raw.githubusercontent.com/.../main/install-linux.sh`, `install-macos.sh` | `https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/releases/download/v0.34.0/install.sh` (asset comprobado). Para instrucciones generales no fijadas, `releases/latest/download/install.sh` exige verificar qué versión resuelve. |
| Instalación Windows     | `raw.githubusercontent.com/.../main/install-windows.ps1`                  | `https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/releases/download/v0.34.0/install.ps1` (asset comprobado). En runbook sustituir `v0.34.0` por `$MOTOR_VERSION`.                                                                |
| Contrato de integración | `blob/main/docs/CLAUDE-CODE-INTEGRATION.md`                               | `https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/blob/v0.34.0/docs/CLI/CONTRACT.md` (§12); para instalación/uso, `USAGE.md` del mismo tag.                                                                                      |
| Estado PowerShell       | `(... \| ConvertFrom-Json).running`                                       | `(... \| ConvertFrom-Json).daemon -eq "running"`; stopped con exit 0 no es error.                                                                                                                                                                         |
| Locuciones              | `synthetic-speech/` como carpeta                                          | `<data_dir>/speech/<voz>/<etiqueta>.wav`; `--synthetic-speech` es **categoría de cleanup**, no carpeta.                                                                                                                                                   |

En la ejecución futura, usar el tag concreto verificado en el smoke; los enlaces `latest` de documentación para instalación ordinaria pueden apuntar a otra versión. Un asset publicado no implica que su ejecución se haya validado.

## Anexo B — JSON de referencia

**Ilustrativos, no fixtures exhaustivos.** `doctor` sano (forma mínima de campos consumidos; el reporte real incluye también `version`, `target`, `channel`, `install`, `path`, `pending` y `models`):

```json
{
  "schema_version": "5",
  "checks": [
    { "name": "models_provisioned", "ok": true, "detail": "modelos presentes" }
  ],
  "failed": []
}
```

`doctor` con **veredicto negativo exit 1** (un solo objeto; `failed` contiene cadenas, `detail` está en `checks`; los demás checks y campos del reporte se omiten **solo por brevedad**):

```json
{
  "schema_version": "5",
  "models": { "missing": ["qwen3-tts-0.6b-base"] },
  "checks": [
    {
      "name": "models_provisioned",
      "ok": false,
      "detail": "falta el modelo Base"
    }
  ],
  "failed": ["models_provisioned"]
}
```

Error operativo de `doctor`, **distinto** del veredicto anterior (exit 1):

```json
{
  "schema_version": "5",
  "reason": "doctor_failed",
  "error": "No se pudo generar el diagnóstico"
}
```

`daemon status`, siempre exit 0 para los estados documentados:

```json
{
  "schema_version": "5",
  "daemon": "running",
  "pid": 1234,
  "engine": "rust_native",
  "warm": "warming"
}
```

```json
{ "schema_version": "5", "daemon": "stopped", "degraded": "unresponsive" }
```

`degraded` no se exige en un `stopped` limpio; `warm` no se exige en `stopped`. No existe `status.path.log` en estos envelopes. El texto literal de `detail`/`error`, el PID y el `engine` anteriores son ejemplos, no garantías de contenido.

## Anexo C — Salidas relevantes

El entero pertenece al **comando y caso**, no basta para deducir el `reason`. La tabla `REASON_CODES` del motor distingue causas; `reason` desconocido no se convierte en remedio específico.

| Comando/caso                                                          |            Exit | `reason` o veredicto                                                             | Lectura permitida por el plugin                                                                     |
| --------------------------------------------------------------------- | --------------: | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `doctor` sano / checks fallidos / error real                          |       0 / 1 / 1 | `failed: []` / `failed: string[]` sin `reason` / `doctor_failed`                 | Diferenciar reporte de objeto `error`.                                                              |
| `daemon status` running, stopped o degraded                           |               0 | `daemon` y `degraded` condicional                                                | El estado se lee del JSON, no del exit.                                                             |
| `daemon start` éxito / modelo ausente / voz warm no hallada           |       0 / 4 / 3 | `started` o `already_running` / `model_missing` / `voice_not_found`              | Solo observable si se ejecuta explícitamente, **no** desde el start desanclado.                     |
| `daemon start` puerto / inalcanzable / reclamo no concluido / bloqueo | 6 / 5 / 16 / 17 | `port_in_use` / `daemon_unreachable` / `daemon_stop_failed` / `lifecycle_locked` | No mapear ninguno desde `status` ni atribuirlo al hook desanclado.                                  |
| `daemon stop` parada inconclusa                                       |               5 | `still_running`, veredicto sin `error`                                           | No consumido por el plugin.                                                                         |
| `speech synthesize` anuncio existente / modelo ausente / daemon caído |       6 / 4 / 5 | `label_exists` / `model_missing` / `daemon_unreachable`                          | `presynth` trata 6 como éxito y resume otros fallos en exit final 1.                                |
| `speech play` locución ausente / sidecar ilegible                     |           3 / 1 | `speech_not_found` / `io_error`                                                  | El 1 no identifica por sí solo la causa: inspeccionar diagnóstico antes de `speech remove --label`. |
| `cleanup` sin categoría / bloqueo / parada fallida                    |     2 / 17 / 16 | `usage_error` / `lifecycle_locked` / `daemon_stop_failed`                        | No consumido; nunca usar `cleanup --all` como remedio del plugin.                                   |

`ExitCode` del motor define, entre otros, 3 `NotFound`, 4 `ModelMissing`, 5 `DaemonUnreachable`, 6 `StateConflict`, 16 `DaemonStopFailed` y **17 `LifecycleLocked`**. No existió en este corte una renumeración 17→16 de `lifecycle_locked`. Para causas de `speech say`, `speech play` y errores genéricos, consultar `SPEECH.md` y `exit_codes.rs` del tag antes de añadir mensajes a un consumidor concreto.
