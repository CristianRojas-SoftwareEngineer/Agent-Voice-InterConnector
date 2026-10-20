# Roadmap — claude-voice-interconnector

Este documento fue originalmente el registro de preparación del primer release
(`RELEASE-READINESS.md`). Ahora que `v0.1.0` está publicado
([commit `f55e8c0`](https://github.com/CristianRojas-SoftwareEngineer/claude-voice-interconnector/tree/v0.1.0),
tag `v0.1.0`, 2026-07-22), se convierte en el **roadmap vivo** del plugin
— el análogo del `ROADMAP.md` del motor AI-Voice-InterConnector, a escala de plugin.

Las secciones que siguen describen **direcciones posibles**, no compromisos.
Cada idea se concretará o descartará según el feedback que llegue tras el
lanzamiento beta. No hay fechas ni prioridades fijas hasta entonces.

## Direcciones para v0.2.0 y siguientes

### Cola FIFO persistente de narración

La Opción 1 (worker que espera su turno en vez de matar al anterior) ya está
implementada en `src/narrate-worker.ts` y resuelve el solapamiento para el caso
de uso habitual (5 hooks, disparos ocasionales). Una mejora posterior sería
reemplazar el esquema actual —un worker efímero por hook que espera— por un
único worker persistente con una cola FIFO interna: cada hook apenda su texto a
la cola y el worker los reproduce uno a uno con `ai-voice-interconnector speech say --daemon`.

Ventajas respecto al esquema actual:

- **Orden libre de carreras por construcción:** un solo consumidor FIFO, sin
  cerradura de archivo PID ni ventana de carrera bajo ráfagas de hooks.
- **Un solo proceso** en vez de N workers desanclados esperando su turno.
- **Ciclo de vida limpio:** el worker se puede apagar y drenar (ej. en
  `SessionEnd`: reproduce lo pendiente y sale).
- **Punto único para políticas y observabilidad:** limitar el largo de la cola,
  descartar el evento más viejo si se llena, mostrar `pendientes: N` en
  `narrate-ctl status`.

_Decisión diferida:_ implementar solo si en uso real se observan ráfagas de
hooks que saturan la cadena de espera de la Opción 1, o si se quieren políticas
de cola (tope, descarte, estado en `status`).

### Mejoras de performance

Áreas identificadas como candidatas a optimización, sin órdenes de magnitud
medidos aún (se determinarán con uso real):

- **Degradación local:** en el MVP determinista el transcript ya **no** alimenta
  al LLM (el input es solo `last_assistant_message`), por lo que
  `readTranscriptMessages` y el parseo JSONL fueron retirados. La degradación
  local usa `clampSentences` sobre el texto ya saneado, con dos topes: hasta
  `LOCAL_SPEECH_MAX_SENTENCES` (2) oraciones, que es el criterio de selección
  porque las primeras frases del turno concentran el resumen general, y
  `LOCAL_SPEECH_MAX_CHARS` (500) como freno de emergencia ante turnos
  patológicos. Ninguno de los dos topes parte una oración: el que frena retira
  siempre la última oración completa, para que el mensaje narrado sea
  autocontenido. Su costo es acotado y no depende del tamaño del transcript. Si
  una iteración futura reintroduce contexto al LLM, volvería a aplicar el punto
  sobre cachear/limitar la cola.
- **Cadena de providers:** hoy los dos providers de la cadena (`gemini` y
  `openrouter`) se intentan en secuencia; `local` no es un provider sino la
  rama de degradación, que vive fuera de la cadena. Un timeout temprano en los
  providers externos aceleraría la caída a `local` cuando no hay conectividad.
- **Worker de narración:** el worker actual se lanza, espera, sintetiza y
  muere por hook; un worker persistente (ver cola FIFO arriba) eliminaría el
  costo de levantar el subproceso en cada llamada.

### Corrección de bugs

No hay bugs reportados aún (beta). Esta sección se poblará con los reportes
que lleguen tras el lanzamiento. El pipeline de CI y la suite de tests
son la primera línea de defensa; el canal de reporte es
[GitHub Security Advisories](https://github.com/CristianRojas-SoftwareEngineer/claude-voice-interconnector/security/advisories)
(para bugs de seguridad) e
[issues públicos](https://github.com/CristianRojas-SoftwareEngineer/claude-voice-interconnector/issues)
(para el resto).

### Gobernanza de versión del motor

`health-check` podría consultar `ai-voice-interconnector version` y avisar —sin
bloquear— si el motor instalado es más viejo que la versión con la que se
verificó el plugin. Hoy la degradación silenciosa es el comportamiento base y está
documentado en `docs/INTEGRATION.md`; la verificación programática sería una
capa adicional de cortesía para el usuario.

### Otras mejoras

Cualquier dirección que emerja del feedback post-beta se registrará aquí.
Hasta entonces el foco es observar cómo se comporta el plugin en uso real,
qué superficies se usan más y dónde roza la experiencia de instalación o
de narración.

## Versionado

El plugin y el motor AI-Voice-InterConnector llevan versionados **independientes**, cada
uno reflejo de su propia historia de desarrollo — lo que se sincroniza entre
ambos es el lanzamiento, no el número. La disparidad de números es temporal
por decisión.

**Convergencia planificada en v1.0.0:** durante el tramo pre-1.0 el plugin
publica sus versiones intermedias (`v0.2.0`, `v0.3.0`, …) al ritmo que
dicten sus correcciones y mejoras, sin relación con los números del motor.
Cuando AI-Voice-InterConnector alcance su `v1.0.0`, el plugin avanzará desde la versión
que haya alcanzado hasta ese momento directamente a `1.0.0`, en un release
que acumule las correcciones implementadas hasta entonces. Ese salto está
registrado en el `CHANGELOG.md` para que no parezca un error de versionado.

## Gestión de API keys — nota de transparencia

El diseño actual sigue buenas prácticas y **no requiere `.env`/`.env.example`**:
el plugin se distribuye clonando el repo (`dist/` commiteado), así que un
`.env` en la raíz viviría dentro del árbol compartido por todos los usuarios
del clon y se pisaría en cada actualización — el lugar correcto para el
secreto de cada usuario es fuera del repo, igual que AI-Voice-InterConnector resuelve su
`data_root()`.

Resumen del diseño (`src/lib/config.ts`, `src/lib/state-dir.ts`):

- Las claves se leen con precedencia **variable de entorno > `config.json` en
  el state dir por SO > sin configurar** (degrada a modo `local`).
- `config.json` nunca vive en el repo; se crea en tiempo de ejecución en
  `%LOCALAPPDATA%\claude-voice-interconnector` (Windows), `~/.local/state/claude-voice-interconnector`
  (Linux) o `~/Library/Application Support/claude-voice-interconnector` (macOS).
- El archivo se escribe con permisos `0600` en POSIX. En Windows la protección
  depende de las ACL del perfil sobre `%LOCALAPPDATA%` (documentado en
  `SECURITY.md`).
- Ninguna skill ni comando pide o maneja la clave dentro del chat (evita que
  quede en el transcript); ambas guían al usuario a variable de entorno o
  edición directa del archivo.
- `narrate-ctl.js status` nunca imprime el valor de la clave, solo si está
  configurada.

## Apéndice: histórico del release v0.1.0

Lo que sigue es el registro del trabajo que llevó al primer release.
Se conserva como referencia de las decisiones tomadas.

### Contexto del release

Primer release público, lanzado en conjunto con AI-Voice-InterConnector v0.7.8.
El plugin llegó con cobertura de tests y documentación equiparable a la
del motor — no en cantidad, sino en las categorías que aplican a su
superficie propia (~17 módulos TypeScript, sin runtime extra, distribuido
clonando el repo).

### Cobertura de testing

Suite de 148 tests con `node --test` (sin framework externo), cubriendo:

| Módulo                                                      | Qué cubre                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/message/sanitize.ts`                                   | Saneamiento de markdown, URLs y descarte del cuerpo de los bloques de código |
| `src/message/clamp.ts`                                      | Recorte determinista por oraciones completas y topes de la degradación local |
| `src/message/provider-chain.ts`                             | Fallback Gemini → OpenRouter → local                                         |
| `src/lib/config.ts`                                         | Precedencia env var > archivo > defaults                                     |
| `src/lib/hook-payload.ts`                                   | Parseo del JSON de Claude Code                                               |
| `src/lib/state-dir.ts`                                      | Resolución del state dir en los 3 SO                                         |
| `src/lib/resolve-cli.ts`                                    | Resolución del binario en PATH (con PATHEXT en Windows)                      |
| `src/message/gemini-provider.ts` / `openrouter-provider.ts` | Parseo de respuesta y errores HTTP (fetch mockeado)                          |
| `src/narrate-ctl.ts`                                        | Subcomandos on/off/mode/status/say; status sin exponer claves                |

La frontera de testing es por **naturaleza del código**, no por módulo: la
**lógica pura** que vive dentro de estos módulos sí se cubre en unitario —p. ej.
`daemon.ts`, cuyo parseo de `daemon status --json` en `isDaemonRunning` se fija
con un shim falso (`tests/daemon.test.ts`)—. Lo que queda fuera a propósito es el
**efecto de orquestación de procesos** en sí (`narrate-hook.ts`,
`narrate-worker.ts`, `spawnDetached`/`killWorkerTree` en `spawn.ts`,
`startDaemonDetached` en `daemon.ts`): lanzar, desanclar y terminar procesos del
SO depende de primitivas específicas por plataforma que un test unitario
determinista no puede observar, y su verificación quedó cubierta por el smoke
test E2E.

### CI

Pipeline en CircleCI con triple puerta `test-linux`/`test-windows`/`test-macos`
(misma nomenclatura que el motor), corriendo en cada push a `main`:
`npm ci && npm run typecheck && npm run build && npm test`.
**Verificado en pipeline #28** (2026-07-22), los tres jobs exitosos.

No hay CD: el plugin no publica artefactos; su "build" (`dist/`) se
commitea y el release es un tag de git.

### Documentación

Las tres piezas documentales requeridas se escribieron:

- `SECURITY.md` — modelo de amenaza, canal de reporte, nota Windows/ACL
- `CHANGELOG.md` — Keep a Changelog, versión sincronizada con el motor
- `docs/RELEASING.md` — proceso de release, bump doble, smoke test,
  referencias cruzadas con el motor

### Sincronización con el motor

El release del motor (v0.7.8) precedió al del plugin. La secuencia fue:

1. Motor corta tag, CI publica binarios nativos por SO
2. Plugin se verifica contra el motor instalado **desde artefactos publicados**
3. Recién entonces se corta el tag del plugin

Smoke test E2E (2026-07-22): las cinco superficies (`UserPromptSubmit`,
`Stop`, `SubagentStop`, `StopFailure`, `Notification`) verificadas en modo
`local` (5 hooks) y `llm` (3 hooks); `narrate-ctl status` sin exponer
claves; aviso sin motor en PATH.

### Checklist completado

1. ✅ **Testing** — suite `node --test`, 100 tests
2. ✅ **CI** — CircleCI triple puerta, pipeline #28 en verde
3. ✅ **Documentación** — SECURITY.md, CHANGELOG.md, docs/RELEASING.md
4. ✅ **Sincronización** — v0.7.8 publicado, smoke test E2E completado
5. ✅ **Corte** — bump 0.1.0, changelog cortado, commit `a360919`,
   tag `v0.1.0` pusheado (2026-07-22)
