# Changelog

Todos los cambios notables de **Agent Voice InterConnector** se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto adhiere a [Versionado Semántico](https://semver.org/lang/es/).

> **Nota sobre el versionado**: este plugin y su motor,
> [AI-Voice-InterConnector](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector),
> llevan versionados **independientes**, cada uno reflejo de su propia historia
> de desarrollo — lo que se sincroniza entre ambos es el lanzamiento, no el
> número. La disparidad de números es temporal por decisión: durante el tramo
> pre-1.0 el plugin publica sus versiones intermedias (`0.2.0`, `0.3.0`, …) a
> su propio ritmo, y cuando AI-Voice-InterConnector alcance su `v1.0.0`, el plugin
> **avanzará desde la versión que haya alcanzado hasta ese momento
> directamente a `1.0.0`**, en un release que acumule las correcciones
> implementadas hasta entonces. Ese salto final de numeración será entonces
> intencional, no un error de versionado.

## [Unreleased]

### Cambiado

- **Renombrado del proyecto: de `tts-sidecar-narrator` a Agent Voice InterConnector**
  (breaking). El plugin se llama `agent-voice-interconnector`; el namespace de
  comandos pasa a `/agent-voice-interconnector:install` y
  `/agent-voice-interconnector:narrate`; el id de instalación a
  `agent-voice-interconnector@Agent-Voice-InterConnector`; el _state dir_ por SO
  a `%LOCALAPPDATA%\agent-voice-interconnector` (Windows),
  `~/.local/state/agent-voice-interconnector` (Linux) o
  `~/Library/Application Support/agent-voice-interconnector` (macOS), por lo que
  la `config.json` existente queda huérfana y hay que re-ejecutar la instalación
  guiada o recrearla; y los labels de las locuciones pre-sintetizadas de
  `narrator-*` a `voice-*` (re-ejecutar `presynth` con el daemon caliente regenera
  los WAV con los labels nuevos; los antiguos pueden retirarse con
  `speech remove --label`). El repo de GitHub se renombró in place: el nombre
  anterior redirige.
- **Licencia del proyecto: de `GPL-3.0-or-later` a `MPL-2.0`** (copyleft a nivel de
  archivo, en paridad con el motor AI-Voice-InterConnector). Quien modifique archivos
  cubiertos debe publicarlos bajo MPL-2.0; la obra mayor que los combina puede
  mantener su licencia propia. Ver `LICENSE` y `NOTICE`.
- **Migración al motor AI-Voice-InterConnector**: la narración invoca
  `speech say --text … --daemon` en lugar del comando `speak`, eliminado sin
  alias en el rediseño de CLI — con el comando anterior el plugin quedaba mudo
  por un fallo silencioso (exit `2` solo visible en `worker.log`).
- **`UserPromptSubmit` es ahora un acuse fijo pre-sintetizado**: reproduce el
  anuncio pre-sintetizado «Procesando con Claude» vía `speech play` (sin modelo ni
  daemon), en lugar de invocar un LLM de narración más síntesis en la ruta
  caliente de cada prompt. Elimina la divergencia semántica del LLM narrador y
  la latencia de red en el momento más visible del ciclo.
- **Los fallbacks estáticos se reproducen desde su WAV pre-sintetizado** (`speech
play`) en vez de re-sintetizarse en cada aparición: el catálogo único de
  anuncios vive en `src/message/static-announcements.ts`, con un label semántico
  fijo por anuncio (p. ej. `voice-stop`) asignado explícitamente, no derivado
  del texto.

### Añadido

- **Subcomando `narrate-ctl presynth`**: pre-sintetiza los seis anuncios del catálogo con
  `speech synthesize --daemon`, idempotente por defecto (exit `6` del
  motor = «ya pre-sintetizado»). Integrado en la instalación guiada
  (`/agent-voice-interconnector:install`) y re-ejecutable a mano tras borrar la caché
  del motor. Acepta `--force` (alias `-f`), que pasa `--force` al motor para
  sobrescribir el WAV de un label existente: el re-sync manual tras cambiar la
  frase de un anuncio (como el label es fijo, `presynth` a secas no detecta el
  cambio).

### Eliminado

- **Modo prompt del subsistema LLM** (`buildPromptMessage`,
  `PROMPT_SYSTEM_PROMPT` y el modo de generación `prompt`), huérfano tras el
  acuse fijo de `UserPromptSubmit`. El modo `summary` (Stop/SubagentStop/
  StopFailure) no cambia.

## [0.1.0] — 2026-07-22

Primera versión pública, lanzada en conjunto con el primer release público del motor AI-Voice-InterConnector. Verificada contra **AI-Voice-InterConnector v0.7.8** (el número final se fija en el corte sincronizado; ver [docs/RELEASING.md](docs/RELEASING.md)).

### Añadido

- **Narración automática por hooks**: al final de cada turno (`Stop`) y en
  avisos relevantes (`Notification`), el plugin construye una locución corta
  en español y la sintetiza vía el CLI `ai-voice-interconnector` (daemon caliente).
  El worker corre desanclado y nunca bloquea ni retrasa el turno.
- **Verificación del entorno en `SessionStart`** (`health-check`): comprueba
  CLI y modelo con `doctor --json`, levanta el daemon si hace falta y avisa —
  sin bloquear — si el motor no está instalado.
- **Dos modos de generación de mensajes**: `llm` (Gemini free → OpenRouter
  `:free`, con opt-in explícito vía API keys) y `local` (determinista,
  100 % offline, el comportamiento por defecto sin claves). La cadena de
  providers degrada en silencio nivel a nivel.
- **Saneamiento para voz** (`sanitize.ts`): antes de narrar o de enviar texto a un
  proveedor externo, elimina markdown, URLs y símbolos no narrables, y descarta
  el cuerpo de los bloques de código cercados. Del código en línea solo retira
  los delimitadores: su texto se conserva para que las rutas y los nombres de
  archivo sigan siendo pronunciables.
- **Superficie de control** (`narrate-ctl`): subcomandos `on`/`off`/`mode`/
  `status`/`say`; `status` nunca imprime el valor de una clave.
- **Comando de instalación guiada** (`/tts-sidecar-narrator:install`) y
  **skill de configuración** (`/tts-sidecar-narrator:narrate`).
- **Suite de tests** (`node --test`, sin dependencias nuevas): 100 tests sobre
  saneamiento, constructor local, cadena de providers, configuración y
  precedencia de claves, parseo del payload de hooks, resolución del state
  dir y del CLI en los tres SO, contrato de los providers con `fetch`
  mockeado, y subcomandos de `narrate-ctl` como subproceso real.
- **CI en CircleCI**: triple puerta `test-linux`/`test-windows`/`test-macos`
  (misma plataforma y nomenclatura que el motor) en cada push, corriendo
  typecheck, build y la suite completa.
- **Documentación**: README, `docs/INTEGRATION.md` (contrato con el motor),
  `SECURITY.md` (modelo de amenaza del plugin, incluida la semántica real de
  la protección del `config.json` en Windows), `docs/RELEASING.md` (proceso
  de release y sincronización con el motor) y este changelog.

[Unreleased]: https://github.com/CristianRojas-SoftwareEngineer/Agent-Voice-InterConnector/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CristianRojas-SoftwareEngineer/Agent-Voice-InterConnector/releases/tag/v0.1.0
