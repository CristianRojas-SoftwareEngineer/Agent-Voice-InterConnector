# tts-sidecar-narrator

Plugin de [Claude Code](https://code.claude.com) que **narra por voz** la actividad de la sesión usando [AI-Voice-InterConnector](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector). Al final de cada turno (y en anuncios relevantes) escuchas un mensaje conversacional corto — no el texto en bruto del asistente, sino una locución procesada, en español.

- **Automático**: disparado por hooks; sin intervención del modelo ni tuya.
- **No intrusivo**: nunca bloquea ni retrasa el turno; falla en silencio si
  AI-Voice-InterConnector no está disponible.
- **Multiplataforma**: Windows / Linux / macOS, misma experiencia.
- **Sin prerequisitos de runtime**: los scripts corren sobre el Node.js que
  Claude Code ya trae; no exige Python.
- **Costo cero**: los mensajes se generan con niveles gratuitos de LLM (Gemini
  free → OpenRouter `:free`) y degradan a un modo local determinista.
- **Controlable**: activa/desactiva la narración sin desinstalar.

> Este repositorio es la fuente de verdad del plugin. El documento de diseño
> original (hoy consolidado en `AI-Voice-InterConnector/docs/DESIGN.md`, en el repo
> del motor) sirvió de especificación inicial y hoy es solo un puntero histórico a este repo.

## Tabla de contenidos

- [Prerequisitos](#prerequisitos)
- [Instalación](#instalación)
- [Configuración](#configuración)
- [Privacidad](#privacidad)
- [Desarrollo](#desarrollo)
- [Documentación](#documentación)
- [Licencia](#licencia)

## Prerequisitos

1. **AI-Voice-InterConnector** instalado (instalador nativo por SO) y
   aprovisionado — el plugin consume su grupo de comandos `speech`, definido en
   el contrato de [`docs/INTEGRATION.md`](docs/INTEGRATION.md):
   ```bash
   ai-voice-interconnector setup
   ```
   El plugin lo verifica al iniciar la sesión (`SessionStart`) y te avisa si
   falta el CLI o el modelo. El plugin **no** instala AI-Voice-InterConnector;
   está verificado contra AI-Voice-InterConnector `v0.34.0`.
2. _(Opcional)_ **API keys gratuitas** para mensajes generados por LLM:
   - [Gemini API](https://ai.google.dev/) (free tier) — principal.
   - [OpenRouter](https://openrouter.ai/) (modelos `:free`) — fallback.

   Sin keys, el plugin funciona en modo **local** (determinista, 100 % offline).

Node.js ya está presente por ser el runtime de Claude Code; los scripts se distribuyen compilados en `dist/`, así que **no hay `npm install` ni build** en tu máquina.

## Instalación

El flujo para el usuario final es de **dos pasos**:

1. **Instalar el plugin** desde un marketplace (repo git), lo que persiste entre
   sesiones:
   ```
   /plugin marketplace add CristianRojas-SoftwareEngineer/tts-sidecar-narrator
   /plugin install tts-sidecar-narrator@tts-sidecar-narrator
   ```
2. **Instalar y configurar el motor** invocando el comando de instalación
   guiado, que detecta el SO, instala el binario AI-Voice-InterConnector
   (instalador nativo por SO), descarga el modelo, deja el daemon listo,
   pre-sintetiza los anuncios (`narrate-ctl presynth`) y activa la narración:
   ```
   /tts-sidecar-narrator:install
   ```

Durante el desarrollo, el plugin se carga apuntando al directorio del repo (no persiste; hay que pasarlo en cada arranque):

```bash
claude --plugin-dir .
```

## Configuración

### Ruta del estado

El estado vive en `config.json` dentro del _state dir_ por SO:

| SO      | Ruta                                                                 |
| ------- | -------------------------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\tts-sidecar-narrator\config.json`                    |
| Linux   | `${XDG_STATE_HOME:-~/.local/state}/tts-sidecar-narrator/config.json` |
| macOS   | `~/Library/Application Support/tts-sidecar-narrator/config.json`     |

### Claves de API (modo `llm`)

La **ruta recomendada** para proveer las claves es la **variable de entorno**, que tiene precedencia sobre el archivo y evita persistir la credencial en disco:

- `GEMINI_API_KEY` (Gemini free tier, principal)
- `OPENROUTER_API_KEY` (modelos `:free`, fallback)

Si prefieres persistencia en archivo —por ejemplo, cuando Claude Code se lanza desde un GUI y no hereda el entorno de tu shell— puedes añadir `"geminiApiKey"` y/o `"openRouterApiKey"` a `config.json`. Sin claves, el modo `llm` degrada a `local` de facto.

### Preferencias (`config.json`)

```json
{
  "enabled": true,
  "messageMode": "llm"
}
```

- `enabled`: interruptor global de la narración.
- `messageMode`: `"llm"` (cadena completa) o `"local"` (solo constructor
  determinista, sin red). Sin ninguna key, `"llm"` degrada a `"local"` de facto.

El archivo se crea con permisos restrictivos donde el SO lo soporta: `0600` en POSIX. En Windows ese bit es un no-op y la protección recae en las ACL del perfil sobre `%LOCALAPPDATA%`; el modelo de amenaza completo (qué se persiste, dónde y con qué permisos en cada SO) está en [SECURITY.md](SECURITY.md). La skill opcional (`/tts-sidecar-narrator:narrate`) guía la configuración y expone los toggles.

## Privacidad

El modo `llm` envía el último mensaje del asistente (`last_assistant_message`, sin transcript ni historial) a un tercero (Google u OpenRouter), y solo en la ruta `Stop`: el resto de eventos siempre reproduce su anuncio pre-sintetizado, sin red. Es un cambio de postura respecto al motor AI-Voice-InterConnector, que sintetiza 100 % offline. Por eso:

1. El modo `llm` **solo se activa cuando configuras tus claves** — un opt-in
   explícito.
2. `messageMode: "local"` ofrece la experiencia completa sin que ningún dato
   salga de tu máquina (mensajes menos elaborados).

## Desarrollo

```bash
npm install       # solo para desarrollo (typescript, esbuild)
npm run typecheck # verificación de tipos
npm run build     # compila src/ → dist/ (commitear dist/)
npm run check-dist # verifica que dist/ está sincronizado con src/
npm test          # suite de tests (node --test, sin framework externo)
```

`dist/` **se commitea**: los plugins se instalan clonando el repo, así que el JS compilado debe estar en el árbol para que los hooks funcionen sin paso de build.

El CI (CircleCI, [.circleci/config.yml](.circleci/config.yml)) corre `typecheck`, `npm run build` y la suite de tests en Linux, Windows y macOS en cada push — el mismo proveedor y nomenclatura de jobs que usa el motor.

## Documentación

- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — integración con el motor
  AI-Voice-InterConnector desde la perspectiva del plugin: contrato del CLI, uso por cada
  hook, requisitos y degradación. Su contraparte, desde la perspectiva del
  motor, está en
  [AI-Voice-InterConnector/docs/CLI/CONTRACT.md §12](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/blob/v0.34.0/docs/CLI/CONTRACT.md#12-contratos-externos).
- [`docs/RELEASING.md`](docs/RELEASING.md) — proceso de release del plugin y
  su sincronización con los releases del motor.
- [`SECURITY.md`](SECURITY.md) — política de seguridad y modelo de amenaza del
  plugin (credenciales, modo `llm`, cadena de suministro).
- [`CHANGELOG.md`](CHANGELOG.md) — cambios notables por versión.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — direcciones futuras del plugin y
  registro histórico del release v0.1.0.

## Licencia

MPL-2.0. Ver `LICENSE` y `NOTICE`.
