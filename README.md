# Agent Voice-InterConnector

Plugin de [Claude Code](https://code.claude.com) que **narra por voz** la actividad de la sesión usando [AI Voice-InterConnector](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector). Al final de cada turno (y en anuncios relevantes) escuchas un mensaje conversacional corto — no el texto en bruto del asistente, sino una locución procesada, en español.

- **Automático**: disparado por hooks; sin intervención del modelo ni tuya.
- **No intrusivo**: nunca bloquea ni retrasa el turno; falla en silencio si
  AI Voice-InterConnector no está disponible.
- **Multiplataforma**: Windows / Linux / macOS, misma experiencia.
- **Sin prerequisitos de runtime**: los scripts corren sobre el Node.js que
  Claude Code ya trae; no exige Python.
- **Costo cero**: los mensajes se generan con niveles gratuitos de LLM (Gemini
  free → OpenRouter `:free`) y degradan a un modo local determinista.
- **Controlable**: activa/desactiva la narración sin desinstalar.

---

## Inicio rápido

```bash
# 1. Instalar el plugin (persiste entre sesiones)
/plugin marketplace add CristianRojas-SoftwareEngineer/Agent-Voice-InterConnector
/plugin install agent-voice-interconnector@Agent-Voice-InterConnector

# 2. Instalar y configurar el motor (guiado, detecta SO, descarga modelo, pre-sintetiza)
/agent-voice-interconnector:install
```

El comando de instalación guía todo el proceso: detecta tu SO, instala el binario nativo, descarga los 5 modelos, levanta el daemon, pre-sintetiza los 6 anuncios estáticos y activa la narración.

---

## Cómo funciona

El plugin se integra via **hooks de Claude Code** y consume la **CLI pública** de AI Voice-InterConnector (`ai-voice-interconnector` en el `PATH`). No hay código compartido ni dependencias de build.

| Hook | Acción | Superficie CLI |
|------|--------|----------------|
| `UserPromptSubmit` | Acuse fijo «Procesando con Claude» | `speech play --label` |
| `Stop` | Resumen del turno (local o LLM) | `speech say --daemon` |
| `SubagentStop` / `StopFailure` / `Notification` | Avisos pre-sintetizados | `speech play --label` |
| `SessionStart` | Health-check + daemon autostart | `doctor --json`, `daemon status --json`, `daemon start` |

El modo `local` (por defecto) es 100 % offline y determinista. El modo `llm` (opt-in con API keys) parafrasea el último mensaje del asistente vía Gemini/OpenRouter.

---

## Configuración

### Estado (`config.json`)

Ubicación por SO:

| SO | Ruta |
|----|------|
| Windows | `%LOCALAPPDATA%\agent-voice-interconnector\config.json` |
| Linux | `${XDG_STATE_HOME:-~/.local/state}/agent-voice-interconnector/config.json` |
| macOS | `~/Library/Application Support/agent-voice-interconnector/config.json` |

### Claves API (modo `llm`)

Preferencia: **variables de entorno** (prevalecen sobre archivo, no persisten en disco):

```bash
export GEMINI_API_KEY=...      # principal
export OPENROUTER_API_KEY=...  # fallback
```

Alternativa: editar `config.json` (útil si Claude Code se lanza desde GUI):

```json
{
  "enabled": true,
  "messageMode": "llm",
  "geminiApiKey": "...",
  "openRouterApiKey": "..."
}
```

- `enabled`: interruptor global
- `messageMode`: `"local"` (determinista, offline) o `"llm"` (parafraseo). Sin keys, `llm` → `local`.

Ver modelo de amenazas completo en [SECURITY.md](SECURITY.md). La skill `/agent-voice-interconnector:narrate` expone toggles interactivos.

---

## Privacidad

- **Modo `local`**: cero red, 100 % offline, mensajes simples.
- **Modo `llm`**: solo en evento `Stop` envía `last_assistant_message` (sin transcript ni historial) a Google/OpenRouter. Opt-in explícito: requiere configurar tus claves.
- El resto de hooks (`UserPromptSubmit`, `SubagentStop`, `StopFailure`, `Notification`) **nunca** usan red: reproducen avisos pre-sintetizados locales.

---

## Desarrollo

```bash
npm install        # dependencias de dev (typescript, esbuild)
npm run typecheck  # verificación de tipos
npm run build      # compila src/ → dist/ (commitear dist/)
npm run check-dist # verifica dist/ sincronizado con src/
npm test           # suite (node --test, sin framework externo)
```

### Reglas del nombre del plugin

- Identidad pública: `agent-voice-interconnector@Agent-Voice-InterConnector`
- Namespace: `/agent-voice-interconnector:*`
- No puede empezar por `claude-` (reservado por Anthropic)
- Debe ser kebab-case (requisito marketplace Claude.ai)

Validación local (mismo gate que CI):

```bash
claude plugin validate --strict .
```

### Distribución

`dist/` **se commitea**: los plugins se instalan clonando el repo, así que el JS compilado debe estar en el árbol para que los hooks funcionen sin paso de build.

### CI

CircleCI (`.circleci/config.yml`): `typecheck`, `build`, `test` en Linux/Windows/macOS + `validate-manifest` (nombre del plugin).

---

## Documentación

- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — contrato CLI, hooks, requisitos, degradación (perspectiva plugin).
- [`docs/RELEASING.md`](docs/RELEASING.md) — proceso de release y sincronización con motor.
- [`SECURITY.md`](SECURITY.md) — política de seguridad, modelo de amenazas, credenciales.
- [`CHANGELOG.md`](CHANGELOG.md) — cambios por versión.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — direcciones futuras e histórico v0.1.0.

Contraparte del motor: [AI-Voice-InterConnector/docs/CLI/CONTRACT.md §12](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/blob/main/docs/CLI/CONTRACT.md#12-contratos-externos).

---

## Licencia

MPL-2.0. Ver `LICENSE` y `NOTICE`.
