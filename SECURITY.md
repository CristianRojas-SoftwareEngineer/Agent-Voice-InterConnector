# Política de seguridad

## Versiones soportadas

Agent Voice InterConnector está en desarrollo activo pre-1.0. Solo la última versión publicada recibe correcciones de seguridad.

| Versión | Soportada |
| ------- | --------- |
| 0.1.x   | ✅        |
| < 0.1.0 | ❌        |

## Cómo reportar una vulnerabilidad

**No** reportes vulnerabilidades de seguridad en Issues públicos.

Usa el canal privado de [**GitHub Security Advisories**](https://github.com/CristianRojas-SoftwareEngineer/Agent-Voice-InterConnector/security/advisories/new) para reportarlas de forma confidencial. Incluye:

- Una descripción de la vulnerabilidad y su impacto.
- Pasos para reproducirla (versión del plugin, versión del motor, SO, evento
  de hook o comando que la dispara).
- Cualquier mitigación conocida.

Recibirás una respuesta inicial en un plazo razonable. Te pedimos no divulgar públicamente el problema hasta que exista una corrección disponible.

Si la vulnerabilidad está en el motor de síntesis y no en el plugin, repórtala en el canal equivalente de [AI-Voice-InterConnector](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/security/advisories/new) (ver su [SECURITY.md](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/blob/main/SECURITY.md)).

## Modelo de amenaza

El plugin es un cliente delgado que corre dentro de la sesión de Claude Code del propio usuario, con sus mismos privilegios. Su superficie es pequeña, pero maneja dos cosas sensibles: **credenciales de API** (opcionales) y **contenido de la sesión**. Estos son sus supuestos, explícitos:

### Qué se persiste, dónde y con qué permisos

- El único estado sensible es `config.json` en el _state dir_ por SO (`%LOCALAPPDATA%\agent-voice-interconnector` en Windows, `${XDG_STATE_HOME:-~/.local/state}/agent-voice-interconnector` en Linux, `~/Library/Application Support/agent-voice-interconnector` en macOS). Puede contener las API keys de Gemini/OpenRouter si el usuario opta por el modo `llm` vía archivo (las variables de entorno `GEMINI_API_KEY` / `OPENROUTER_API_KEY` tienen precedencia y evitan persistir la clave).
- En POSIX el archivo se escribe con permisos **`0600`** (solo el dueño lee y escribe).
- **En Windows, `0600` es un no-op**: el modo de archivo no existe en NTFS y Node lo ignora. La protección real son las **ACL por defecto del perfil de usuario** sobre `%LOCALAPPDATA%`: otras cuentas locales sin privilegios elevados no pueden leer ese directorio. Es el mismo nivel de protección que tienen las credenciales de la mayoría de las herramientas de escritorio en Windows; si tu máquina comparte la misma cuenta de Windows entre varias personas, esa frontera no existe — usa variables de entorno de sesión o el modo `local`.
- El resto del state dir (`worker.pid`, `payload.json`, `worker.log`) contiene metadatos operativos y extractos del último payload de hook; vive bajo el mismo directorio y las mismas protecciones.

### Qué sale hacia terceros y bajo qué opt-in

- En modo `llm` — **que solo se activa si el usuario configura una clave**, es un opt-in explícito — solo la ruta `Stop` puede enviar contenido a un tercero: el `last_assistant_message` del payload (ni transcript ni historial) viaja a la API de Gemini (Google) o de OpenRouter para redactar la locución. Ese texto viaja **sin sanear**: el modelo necesita el markdown original para entender la estructura del turno, así que de él solo se acota el tamaño (`clampHead`), nunca el contenido. Trata el modo `llm` como lo que es: compartir el último mensaje completo del turno con un tercero. El saneo de `src/message/sanitize.ts` se aplica a la salida del modelo y a la degradación local, nunca al material que sale: descarta el cuerpo de los bloques de código cercados, conserva el texto del código en línea (donde viajan las rutas y los identificadores) y elimina URLs, markdown y símbolos no narrables.
- Los eventos `Notification`, `SubagentStop`, `StopFailure` y `UserPromptSubmit` **nunca** usan el modo `llm`: da igual la configuración de `messageMode` o las claves presentes, su locución es siempre un anuncio pre-sintetizado del catálogo (`src/message/static-announcements.ts`), reproducido con `speech play` y sin invocar ningún proveedor. Es una barrera estructural, no una omisión: `Notification` en particular suele dispararse en contextos sensibles (peticiones de permiso, alertas) y su texto ya viene redactado por Claude Code, así que no hay valor en parafrasearlo y sí riesgo en enviarlo a un tercero. En consecuencia, en modo `llm` el único evento que puede llegar a salir a la red es `Stop`, y solo si hay material narrable y una clave configurada.
- En modo `local` (el comportamiento sin claves) **nada sale a la red**: el mensaje se construye de forma determinista y se sintetiza con el motor AI-Voice-InterConnector, que es 100 % offline.
- Las claves viajan **solo en headers** (`x-goog-api-key` / `Authorization: Bearer`), nunca en URLs (que suelen quedar en logs), y las peticiones van únicamente a los endpoints oficiales de cada proveedor. Esto está fijado por tests de contrato (`tests/providers.test.ts`).

### Qué no hace el plugin

- **No pide ni maneja claves dentro del chat**: ni la skill ni el comando de instalación piden la clave en la conversación (evita que quede en el transcript); ambos guían al usuario a la variable de entorno o a editar el archivo directamente.
- **No imprime el valor de una clave**: `narrate-ctl status` reporta solo `configurada`/`ausente`. Esta garantía está fijada por contrato en `tests/narrate-ctl.test.ts`.
- **No manda nada a la red en modo `local`**, ni telemetría en ningún modo.
- **No ejecuta contenido de la sesión**: el payload de los hooks se parsea de forma tolerante (`src/lib/hook-payload.ts`) y su texto solo se usa como entrada de saneamiento; el único proceso que el plugin lanza es el ejecutable `ai-voice-interconnector` resuelto del `PATH`, con argumentos fijos.

### Cadena de suministro

- El plugin se distribuye clonando el repo con `dist/` **commiteado**; lo que ejecutas es el JS del árbol de git. El CI verifica en cada push que `dist/` es exactamente la compilación de `src/` (`npm run check-dist`), de modo que el fuente publicado y el artefacto ejecutado no puedan divergir sin que el pipeline falle.
- No hay **ninguna dependencia de runtime**: los bundles solo usan la stdlib de Node y `fetch` nativo. Las dependencias de desarrollo (typescript, esbuild, @types/node) van fijadas por `package-lock.json` y no se instalan en la máquina del usuario final.
