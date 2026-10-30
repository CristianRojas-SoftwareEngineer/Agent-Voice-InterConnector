# Especificación de diseño: clonado de voz y voz activa

> **Estado**: propuesta, no implementada · **Versión base del plugin**: 0.1.0 ·
> **Contrato del motor verificado**: v0.36.2 · **Fecha**: 2026-10-27

Este documento analiza el requerimiento de exponer el clonado de voz del motor
AI Voice-InterConnector a través del plugin, fija el diseño y define los
criterios de aceptación. Es la fuente de verdad funcional de la feature; la
implementación, la documentación de usuario y los tests se derivan de él.

## Tabla de contenidos

- [1. Propósito](#1-propósito)
- [2. Alcance](#2-alcance)
- [3. Contexto actual](#3-contexto-actual)
- [4. Glosario](#4-glosario)
- [5. Requisitos](#5-requisitos)
- [6. Análisis de alternativas y decisiones](#6-análisis-de-alternativas-y-decisiones)
- [7. Diseño](#7-diseño)
- [8. Invariantes y casos límite](#8-invariantes-y-casos-límite)
- [9. Errores y mensajes](#9-errores-y-mensajes)
- [10. Estrategia de pruebas](#10-estrategia-de-pruebas)
- [11. Criterios de aceptación](#11-criterios-de-aceptación)
- [12. Documentación afectada](#12-documentación-afectada)
- [13. Riesgos y trabajo futuro](#13-riesgos-y-trabajo-futuro)
- [14. Referencias](#14-referencias)

---

## 1. Propósito

Permitir que el usuario narre la actividad de Claude Code con **su propia voz**
en lugar de la voz de fábrica `default`, sin romper la arquitectura actual del
plugin:

- el plugin sigue siendo un **cliente delgado** del motor;
- el motor sigue siendo el dueño del audio, del clonado y del almacén de voces;
- el plugin solo guarda el **nombre** de la voz activa;
- la voz se aplica de forma consistente a la pre-síntesis, a la reproducción de
  anuncios y a la síntesis dinámica del evento `Stop`.

## 2. Alcance

### Dentro del alcance

- Clonar una voz a partir de un archivo WAV de referencia o directamente desde el micrófono en vivo y asignarle un nombre.
- Listar las voces disponibles.
- Activar una voz y persistirla como preferencia no secreta.
- Pre-sintetizar los seis anuncios estáticos bajo la voz activa.
- Reproducir los anuncios y sintetizar el resumen de `Stop` con la voz activa.
- Arrancar el daemon con la voz activa como voz de calentamiento.
- Borrar voces de usuario con confirmación y protección de las voces de fábrica.
- Diagnosticar el estado de la voz activa.
- Guiar al usuario en la obtención de la referencia (archivo o micrófono) y en los requisitos del
  motor.
- Documentar el contrato ampliado y cubrirlo con tests.

### Fuera del alcance

- Capturar o procesar audio PCM directamente en el código TypeScript del plugin. La captura interactiva de micrófono o la lectura de archivo se delega íntegramente a la CLI del motor `ai-voice-interconnector voice clone`.
- Perfiles de voz por evento (`voice-stop`, `voice-notification`, etc.).
- Varias voces activas simultáneas o selección de voz por sesión.
- Entrenamiento, edición o fusión de voces.
- Clonado remoto: el motor es local y el audio de referencia no sale de la máquina.
- Migración automática de locuciones entre voces: no existe copia de WAVs entre
  namespaces de voz.

## 3. Contexto actual

Hoy el plugin **no selecciona voz**. Las tres rutas omiten `--voice`:

| Ruta            | Invocación actual                               |
| --------------- | ----------------------------------------------- |
| Pre-síntesis    | `speech synthesize --text … --label … --daemon` |
| Reproducción    | `speech play --label …`                         |
| `Stop` dinámico | `speech say --text … --daemon`                  |

El motor resuelve la voz de fábrica `default` cuando `--voice` falta. `default`
es una voz clonada de fábrica con una huella `reference.qvoice` embebida; no es
un preset. Las locuciones se almacenan en el motor bajo la clave
`(voz, etiqueta)`, en `<data_dir>/speech/<voz>/<etiqueta>.wav`.

Consecuencias del diseño actual:

- no hay personalización;
- la pre-síntesis, la reproducción y la síntesis dinámica comparten la misma
  voz implícita;
- si se introduce una voz distinta en una sola ruta, las otras fallan con cache
  miss o `voice_not_found`;
- `config.json` solo guarda `enabled` y `messageMode`.

## 4. Glosario

| Término              | Definición                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Voz**              | Entrada del registro `VoiceStore` del motor. Puede ser de fábrica (`default`, `ryan`, `vivian`) o clonada por el usuario.                                               |
| **Voz clonada**      | Voz creada por `voice clone` a partir de una referencia de audio (archivo WAV o micrófono). El motor guarda solo la huella de timbre (`reference.qvoice`), no el audio. |
| **Voz activa**       | Nombre de la voz que el plugin persiste en `config.json` y usa en todas las rutas de narración.                                                                         |
| **Referencia**       | Muestra de audio que el usuario entrega a `voice clone` (archivo WAV o captura de micrófono). Se recomiendan ~10 s; el motor rechaza más de 30 s.                       |
| **Huella de timbre** | Archivo `reference.qvoice` que produce el clonado. No contiene transcripción ni idioma.                                                                                 |
| **Etiqueta**         | Identificador fijo de una locución pre-sintetizada (`voice-user-prompt-submit`, `voice-stop`, etc.).                                                                    |
| **Locución**         | WAV pre-sintetizado y persistido por el motor bajo `(voz, etiqueta)`.                                                                                                   |
| **Pre-síntesis**     | Ejecución única de `speech synthesize` para cada etiqueta del catálogo, con el fin de que `speech play` sea instantáneo.                                                |
| **Cache miss**       | `speech play` no encuentra la locución para la voz y etiqueta solicitadas. El motor sale con exit `3`.                                                                  |

## 5. Requisitos

### 5.1 Requisitos funcionales

| ID        | Requisito                                                                                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RF-01** | El plugin debe permitir clonar una voz delegando en el motor vía `ai-voice-interconnector voice clone --name <nombre> [--speech-reference <wav> \| --mic [--duration <seg>]] [--force] --daemon --json`. |
| **RF-02** | El plugin debe validar el nombre y bloquear el clonado sobre voces de fábrica (`default`, `ryan`, `vivian`) en el MVP.                                                                                   |
| **RF-03** | El plugin debe listar las voces disponibles con `voice list --json` y señalar cuál es la activa y cuáles son de fábrica.                                                                                 |
| **RF-04** | El plugin debe permitir activar una voz existente y persistir su nombre en `config.json` como `voice`.                                                                                                   |
| **RF-05** | La activación debe pre-sintetizar los seis anuncios del catálogo bajo la voz candidata antes de persistirla.                                                                                             |
| **RF-06** | La pre-síntesis manual (`narrate-ctl presynth`) debe usar la voz activa y aceptar `--force` para re-sintetizar tras cambios de texto o de timbre.                                                        |
| **RF-07** | `speech play --label` debe ejecutarse con `--voice <activa>` en todos los hooks estáticos.                                                                                                               |
| **RF-08** | `speech say --text … --daemon` debe ejecutarse con `--voice <activa>` en la ruta `Stop` y en `narrate-ctl say`.                                                                                          |
| **RF-09** | El arranque del daemon debe usar `daemon start --warm-voice <activa>` cuando la voz activa sea distinta de la voz de calentamiento por defecto.                                                          |
| **RF-10** | El plugin debe permitir borrar voces de usuario con confirmación explícita, protección de fábrica y protección de la voz activa.                                                                         |
| **RF-11** | El plugin debe mostrar la voz activa en `narrate-ctl status` y advertir en `SessionStart` si la voz activa no existe.                                                                                    |
| **RF-12** | Si la voz activa no existe en tiempo de ejecución, el plugin no debe caer silenciosamente a otra voz: registra el fallo y deja el turno sin audio.                                                       |
| **RF-13** | El plugin no debe copiar, mover ni borrar el archivo de referencia ni manipular buffers de micrófono; delega la I/O de audio al motor.                                                                   |
| **RF-14** | El plugin no debe guardar audio, rutas de referencia ni secretos en `config.json`.                                                                                                                       |
| **RF-15** | La feature debe ser opt-in: una instalación sin clonado debe seguir funcionando exactamente como hoy con `default`.                                                                                      |
| **RF-16** | La documentación del plugin debe explicar los requisitos de la referencia (archivo o micrófono en vivo), la privacidad y el costo de cambiar de voz.                                                     |

### 5.2 Requisitos no funcionales

| ID         | Requisito                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **RNF-01** | Sin dependencias nuevas de runtime: solo Node.js y la CLI del motor.                                                                |
| **RNF-02** | El launcher de hooks no debe invocar `voice list`, `voice clone` ni el daemon: sigue saliendo en menos de 100 ms y solo encola.     |
| **RNF-03** | La lógica de nombres, parseo de `voice list` y construcción de argumentos debe ser pura y testeable sin motor.                      |
| **RNF-04** | Toda la operación debe pasar por `narrate-ctl`; no se crean scripts paralelos ni se duplica la lógica en el comando de Claude Code. |
| **RNF-05** | Los timeouts de las invocaciones al motor deben respetar el presupuesto de `SessionStart` (30 s).                                   |
| **RNF-06** | Los errores del motor se traducen a mensajes accionables y códigos estables; nunca se muestra un stack trace.                       |
| **RNF-07** | El comportamiento debe ser idéntico en Windows, Linux y macOS, incluidas rutas con espacios y shims `.cmd` en Windows.              |
| **RNF-08** | `lint`, `format:check`, `typecheck`, `test` y `check-dist` deben pasar en CI en los tres sistemas.                                  |

## 6. Análisis de alternativas y decisiones

### 6.1 Superficie de control

| Alternativa                                                                     | Valoración                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Extender `narrate-ctl` con una familia `voice` y añadir un comando `/voice`** | **Elegida.** Una sola implementación determinista, testeable con CLI falso, coherente con `on/off/mode/say/presynth`. El comando de Claude Code solo explica y orquesta. |
| Script separado `voice-ctl.js`                                                  | Duplica resolución de CLI, config y manejo de errores. Descartada.                                                                                                       |
| Solo skill, sin CLI determinista                                                | El modelo construiría comandos a mano; difícil de testear y de mantener. Descartada.                                                                                     |

### 6.2 Ruta de clonado

| Alternativa                           | Valoración                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`voice clone … --daemon`**          | **Elegida.** El daemon ya tiene el modelo Base cargado o lo carga una vez; además dispara warm-on-clone y deja la voz lista para la pre-síntesis. |
| `voice clone … --no-daemon`           | Funciona, pero carga el modelo en un proceso efímero y no precalienta al daemon. Se reserva para troubleshooting manual.                          |
| Fallback automático de daemon a local | Añade latencia impredecible y dos caminos que probar. Descartado en el MVP.                                                                       |

### 6.3 Momento de la pre-síntesis

| Alternativa                                                                | Valoración                                                                                                              |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **`voice use` pre-sintetiza con `--force` y solo después persiste la voz** | **Elegida.** Garantiza que la voz activa tiene las seis locuciones con el timbre correcto y evita estados a medias.     |
| Pre-síntesis perezosa en el primer `play`                                  | El primer turno quedaría sin audio o pagaría una síntesis dentro de la ruta caliente. Descartada.                       |
| `presynth` idempotente sin `--force`                                       | No detecta un re-clonado del mismo nombre ni un cambio de texto: dejaría WAVs obsoletos. Descartada para la activación. |

El costo aceptado es seis síntesis por cambio de voz. Es una operación manual y
poco frecuente; la latencia no afecta a los hooks.

### 6.4 Cambio de voz y daemon

El residente TTS del motor es de una sola voz: al sintetizar con otra voz,
termina el residente anterior y arranca uno nuevo. Por eso:

- **no hace falta reiniciar el daemon** al cambiar de voz;
- la pre-síntesis de `voice use` ya deja caliente la voz nueva;
- en `SessionStart`, si el daemon está parado, se arranca con la voz activa;
- si el daemon ya está corriendo, no se reinicia: la primera síntesis con otra
  voz paga el cold-start de reemplazo.

### 6.5 Política de fallback

| Alternativa                            | Valoración                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sin fallback automático en runtime** | **Elegida.** Mantiene la invariante «una sola voz por sesión», no mezcla timbres y no muta la configuración del usuario sin permiso. `SessionStart` avisa y el fallo queda en `worker.log`. |
| Caer a `default` en `play`/`say`       | Robusto, pero puede producir una locución con una voz distinta a la elegida. Se deja como mejora futura.                                                                                    |
| Auto-reparar `config.json` a `default` | Sorprende al usuario y oculta la causa. Descartada.                                                                                                                                         |

### 6.6 Decisiones cerradas

| ID       | Decisión                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D-01** | Una sola voz activa global, persistida como `voice` en `config.json`.                                                                                                    |
| **D-02** | `narrate-ctl` expone `voice list`, `voice clone`, `voice use` y `voice remove`; el comando `/agent-voice-interconnector:voice` es la capa de explicación y confirmación. |
| **D-03** | `voice clone` usa siempre el daemon en el MVP.                                                                                                                           |
| **D-04** | `voice use` valida la voz, pre-sintetiza con `--force` y solo entonces escribe la configuración.                                                                         |
| **D-05** | La voz activa se pasa siempre de forma explícita (`--voice`), incluido `default`, para no depender del default implícito del motor.                                      |
| **D-06** | Las voces de fábrica no se clonan encima ni se borran desde el plugin.                                                                                                   |
| **D-07** | La voz activa no se puede borrar: primero hay que activar otra.                                                                                                          |
| **D-08** | `voice remove` exige `--yes` en `narrate-ctl`; el comando de Claude Code pide la confirmación conversacional.                                                            |
| **D-09** | No hay fallback automático a `default` en runtime. `SessionStart` avisa si la voz activa no existe.                                                                      |
| **D-10** | El plugin no guarda audio, rutas de referencia ni secretos; solo el nombre de la voz.                                                                                    |
| **D-11** | `sessionStart` arranca el daemon con `--warm-voice <activa>` solo cuando está parado y la voz existe.                                                                    |

## 7. Diseño

### 7.1 Configuración

`config.json` incorpora un único campo nuevo, no secreto:

```json
{
  "enabled": true,
  "messageMode": "local",
  "voice": "default"
}
```

Reglas:

- `voice` ausente, vacío o inválido → `"default"` (compatibilidad con
  instalaciones existentes).
- Se normaliza a minúsculas y se recorta.
- `loadConfig()` no consulta al motor; solo lee el archivo y el entorno.
- `updateConfig()` acepta `voice` en el parche y lo persiste.
- `narrate-ctl status` muestra `voice: <nombre>`.
- No se guardan la ruta del WAV ni `reference.qvoice`.

### 7.2 Módulo `src/lib/voice.ts`

Nuevo módulo puro, sin I/O:

```ts
export const DEFAULT_VOICE = "default";
export const FACTORY_VOICES = ["default", "ryan", "vivian"] as const;

export function normalizeVoiceName(raw: string): string;
export function isPlausibleVoiceName(name: string): boolean;
export function isFactoryVoice(name: string): boolean;
export function parseVoiceListOutput(text: string): string[] | undefined;
```

Responsabilidades:

- normalizar y validar nombres de forma conservadora;
- reconocer las voces de fábrica;
- parsear `{"voices": ["default", ...]}` y rechazar shapes inválidos;
- no duplicar las reglas profundas del motor: el motor sigue siendo la
  autoridad final sobre el nombre, el audio y la duración.

### 7.3 Superficie `narrate-ctl`

```text
node dist/narrate-ctl.js voice list
node dist/narrate-ctl.js voice clone <nombre> <ruta.wav> [--force]
node dist/narrate-ctl.js voice clone <nombre> --mic [--duration <segs>] [--force]
node dist/narrate-ctl.js voice use <nombre>
node dist/narrate-ctl.js voice remove <nombre> --yes
node dist/narrate-ctl.js status
node dist/narrate-ctl.js presynth [--force]
node dist/narrate-ctl.js say "<texto>"
```

Comportamiento:

- **`voice list`**: ejecuta `voice list --json`; imprime todas las voces, marca
  la activa y las de fábrica.
- **`voice clone`**:
  - Valida nombre y bloquea voces de fábrica.
  - Si se pasa `<ruta.wav>`: valida que el archivo exista; ejecuta
    `ai-voice-interconnector voice clone --name <nombre> --speech-reference <ruta.wav> [--force] --daemon --json`.
  - Si se pasa `--mic`: en terminal interactiva (TTY) o con `--duration <segs>`,
    ejecuta `ai-voice-interconnector voice clone --name <nombre> --mic [--duration <segs>] [--force] --daemon --json`
    heredando `stdio` para permitir push-to-talk si aplica.
  - Si el nombre ya existe y no hay `--force`, informa exit `6`.
  - Si hay `--force` y la voz es la activa, re-sintetiza con `presynth --force`.
- **`voice use`**: verifica que la voz exista con `voice list --json`; ejecuta
  la pre-síntesis forzada de las seis etiquetas; solo si todas terminan bien
  escribe `voice` en `config.json`.
- **`voice remove`**: exige `--yes`; rechaza voces de fábrica y la voz activa;
  ejecuta `voice remove --name <nombre> --yes` y reporta las locuciones
  arrastradas.
- **`presynth`**: usa `cfg.voice`; añade `--voice` y `--daemon`; exit `6` cuenta
  como éxito idempotente.
- **`say`**: usa `cfg.voice`; añade `--voice` a `speech say --daemon`.
- **`status`**: incluye `voice: <nombre>` además de los campos actuales.

### 7.4 Flujo de clonado

```text
Usuario
  │  /agent-voice-interconnector:voice clone <nombre> [<ruta.wav> | --mic [--duration <seg>]]
  ▼
Comando Claude Code
  │  1. valida explicación y confirmación (o guía de grabación de micrófono)
  │  2. invoca narrate-ctl voice clone
  ▼
narrate-ctl
  │  3. comprueba CLI, nombre, argumento de entrada y voces de fábrica
  │  4. ejecuta voice clone --name … [--speech-reference … | --mic …] --daemon --json
  │  5. interpreta {name, speech, precomputed}
  │  6. si --force y la voz es la activa → presynth --force
  ▼
Motor AI Voice-InterConnector
  │  Adquiere audio (lee WAV o graba de cpal vía avi-audio)
  │  VoiceStore::save_reference(nombre, reference.qvoice)
  │  warm-on-clone de la voz nueva en segundo plano
  ▼
Usuario recibe: voz creada y siguiente paso (voice use <nombre>)
```

Detalles:

- Se recomienda una referencia de ~10 s; el motor acepta hasta 30 s (tanto en archivo como en micrófono).
- El motor consume el audio y guarda solo la huella de timbre; ningún audio WAV permanece persistido en disco.
- `precomputed: true` significa «precarga en caliente iniciada», no que la voz
  esté lista para el primer uso.
- Si el nombre ya existe y no hay `--force`, no se sobrescribe nada.
- Si se sobrescribe la voz activa, la pre-síntesis forzada es obligatoria para
  que las locuciones no conserven el timbre anterior.
- El plugin no activa automáticamente la voz recién clonada.

### 7.5 Flujo de activación

```text
voice use <nombre>
  │
  ├─ ¿nombre válido? ── no → exit 2
  ├─ ¿voz existe? ──── no → exit 3
  ├─ ¿daemon disponible? ─ no → exit 5 con remedio
  │
  ├─ presynth --force --voice <nombre>  (seis etiquetas)
  │     ├─ exit 0 → etiqueta sintetizada
  │     ├─ exit 6 → ya existía (éxito idempotente)
  │     └─ otro   → fallo; no se toca config
  │
  └─ updateConfig({ voice: <nombre> })
```

La operación es transaccional desde la perspectiva del plugin: la voz activa
anterior sigue vigente hasta que las seis etiquetas de la voz candidata estén
correctas. Si la pre-síntesis falla a mitad, las etiquetas ya escritas quedan en
el motor, pero la configuración no cambia; un reintento las reutiliza.

### 7.6 Flujo de pre-síntesis

Para cada entrada de `ANNOUNCEMENTS`:

```bash
ai-voice-interconnector speech synthesize \
  --text "<texto>" \
  --label "<label>" \
  --voice "<voz activa>" \
  --daemon \
  [--force]
```

- `--force` se usa en `voice use` y en `presynth --force`.
- Sin `--force`, exit `6` significa «ya existe esa etiqueta para esa voz» y se
  considera éxito.
- Un cambio de texto del catálogo no cambia el label: hay que ejecutar
  `presynth --force` para re-sintetizar.
- Un re-clonado del mismo nombre con `--force` no cambia el label: también exige
  `presynth --force`.

### 7.7 Rutas de runtime

`buildMessage()` no cambia: sigue decidiendo **qué** se narra (etiqueta o
texto). La voz es una preocupación de transporte y se añade en el worker y en
`narrate-ctl`.

| Componente                                  | Cambio                                                   |
| ------------------------------------------- | -------------------------------------------------------- |
| `src/narrate-worker.ts` → `runPlay`         | `speech play --label <label> --voice <cfg.voice>`        |
| `src/narrate-worker.ts` → `runSay`          | `speech say --text <texto> --voice <cfg.voice> --daemon` |
| `src/narrate-ctl.ts` → `say`                | `speech say --text <texto> --voice <cfg.voice> --daemon` |
| `src/narrate-ctl.ts` → `presynth`           | `speech synthesize … --voice <cfg.voice> --daemon`       |
| `src/lib/daemon.ts` → `startDaemonDetached` | acepta `warmVoice` y añade `--warm-voice`                |

`buildMessage()` no debe recibir ni devolver la voz. Esto evita mezclar la
selección editorial del mensaje con la identidad de la voz.

### 7.8 `SessionStart` y daemon

`health-check` mantiene su orden actual:

1. `doctor --json`.
2. `daemon status --json` solo si el diagnóstico es sano.
3. Si el daemon está parado, `daemon start --warm-voice <voz activa>`.
4. Si está corriendo, no se reinicia.
5. Si la voz activa no es `default`, se valida con `voice list --json` antes de
   arrancar; si no existe, se emite `systemMessage` y no se arranca el daemon.
6. Si el daemon está corriendo con otra voz, la primera síntesis paga el
   cold-start de reemplazo; no se reinicia por eso.

Presupuesto: `doctor` ≤20 s + `daemon status` ≤5 s + `voice list` ≤2 s = 27 s
bajo el timeout de 30 s del hook. La validación de voz se omite cuando la voz
activa es `default`.

### 7.9 Borrado de voces

`voice remove` es destructivo: el motor borra la voz y **arrastra sus
locuciones**. El plugin:

1. exige `--yes` en `narrate-ctl`;
2. rechaza voces de fábrica antes de invocar al motor;
3. rechaza la voz activa y pide activar otra primero;
4. invoca `voice remove --name <nombre> --yes`;
5. reporta `removed_speech` para que el usuario sepa qué locuciones se borraron.

El comando de Claude Code pide confirmación explícita y muestra el aviso de
arrastre antes de ejecutar.

### 7.10 Contrato del motor ampliado

El plugin pasa de seis a nueve superficies estables:

| Superficie                                                                                                             | Uso                                    |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `voice clone --name <n> [--speech-reference <wav> \| --mic [--duration <segs>]] [--force] [--denoise] --daemon --json` | Clonado desde archivo o micrófono.     |
| `voice list --json`                                                                                                    | Listado y validación de la voz activa. |
| `voice remove --name <n> --yes`                                                                                        | Borrado de una voz de usuario.         |

Además, se añaden flags a superficies existentes:

- `--voice <n>` en `speech synthesize`, `speech say` y `speech play`;
- `--warm-voice <n>` en `daemon start`.

El contrato debe documentar los campos y códigos de salida que el plugin
consume:

| Operación           | Salida relevante                  | Códigos                                                                                                                                    |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `voice clone`       | `{name, speech, precomputed}`     | `0`; `1` clone/io; `2` nombre/audio/duración/no-tty; `3` audio no encontrado; `4` modelo; `5` daemon; `6` voz existente; `10` mic hardware |
| `voice list`        | `{voices: string[]}`              | `0`; `1` listado                                                                                                                           |
| `voice remove`      | `{status, voice, removed_speech}` | `0`; `1` io; `2` fábrica/nombre; `3` voz no encontrada                                                                                     |
| `speech synthesize` | `{status, audio_path, voice}`     | `0`; `6` label existente; `4`/`5`/`3` precondiciones                                                                                       |
| `speech say`        | `{status, voice}`                 | `0`; `3` voz; `4`/`5` precondiciones                                                                                                       |
| `speech play`       | `{status, label, voice}`          | `0`; `3` label o voz; `2` identificador                                                                                                    |

Si el motor no soporta `voice` (versión antigua), el plugin debe reportar que la
feature no está disponible y mantener la narración con `default`; no debe
romper los hooks.

### 7.11 UX

Se añade `commands/voice.md`:

```text
/agent-voice-interconnector:voice clone <nombre> [<ruta.wav> | --mic [--duration <segs>]]
/agent-voice-interconnector:voice list
/agent-voice-interconnector:voice use <nombre>
/agent-voice-interconnector:voice remove <nombre>
```

El comando debe explicar en español:

- qué es una referencia de voz y cuánto debe durar (~10 s, máx 30 s);
- que se puede clonar pasando un archivo WAV o grabando directamente desde el micrófono con `--mic`;
- que el motor guarda solo el timbre (`reference.qvoice`), no el audio;
- que la voz no se activa sola;
- que cambiar de voz re-sintetiza los anuncios;
- que borrar una voz borra sus locuciones;
- que el audio de referencia no se sube a ninguna nube.

Se extiende `skills/narrate/SKILL.md` con la sección de voces para que el modelo
reconozca intenciones como «clona mi voz», «usa mi voz» o «vuelve a la voz
predeterminada» y las enrute a `narrate-ctl`.

El instalador guiado añade un paso opcional después de la pre-síntesis de
`default`: si el usuario acepta, clona su voz (guiándolo con micrófono o archivo) y ejecuta `voice use`. Si no
acepta, la instalación queda idéntica a la actual.

### 7.12 Concurrencia

- El launcher de hooks no cambia: sigue encolando y lanzando el worker.
- `voice use` es una operación manual; puede convivir con un worker en curso.
  Un ítem ya reclamado puede narrarse con la voz anterior; el siguiente lee la
  configuración nueva. Es una ventana aceptable.
- El motor serializa la síntesis con su propio lock; el plugin no añade locks.
- La cola FIFO y el lock `worker.pid` no se tocan.

## 8. Invariantes y casos límite

1. **Una voz por sesión**: `presynth`, `play`, `say` y `narrate-ctl say` usan
   exactamente `config.voice`.
2. **La voz activa siempre tiene las seis locuciones**: `voice use` no persiste
   la voz hasta que la pre-síntesis forzada termina bien.
3. **No hay copia de locuciones entre voces**: cambiar de voz no reutiliza WAVs
   de `default` ni de otra voz; por eso la pre-síntesis es obligatoria.
4. **Las voces de fábrica son intocables desde el plugin**: no se clonan encima
   ni se borran.
5. **La voz activa no se borra**: primero hay que activar otra.
6. **El audio de referencia es del usuario**: el plugin no lo copia, no lo mueve y
   no lo borra.
7. **Sin secretos en configuración**: `config.json` solo contiene preferencias.
8. **Sin fallback silencioso**: si la voz activa desaparece, se avisa en
   `SessionStart` y se registra el fallo; no se cambia de timbre en caliente.
9. **Re-clonar no actualiza locuciones por sí solo**: hace falta
   `presynth --force`.
10. **El daemon no se reinicia por cambiar de voz**: el residente se reemplaza
    bajo demanda y la pre-síntesis lo deja caliente.
11. **La voz no altera el contenido del mensaje**: `buildMessage()` sigue siendo
    independiente de la voz.
12. **Un fallo de voz no bloquea el turno**: se registra y el turno sigue sin
    audio, como cualquier fallo del motor.

## 9. Errores y mensajes

| Condición                                  | Origen                | Acción del plugin                  | Mensaje orientativo                                                          |
| ------------------------------------------ | --------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| CLI no encontrado                          | `resolveCli()`        | No invoca nada; exit 1             | «AI Voice-InterConnector no está en el PATH.»                                |
| Daemon caído en clone/use/presynth/say     | Motor exit `5`        | No reintenta en local; exit 5      | «Levanta el daemon con `ai-voice-interconnector daemon start`.»              |
| Modelo Base ausente                        | Motor exit `4`        | Exit 4                             | «Ejecuta `ai-voice-interconnector setup`.»                                   |
| WAV no encontrado                          | Plugin                | Exit 3; no invoca al motor         | «La ruta de referencia no existe.»                                           |
| WAV inválido o >30 s                       | Motor exit `2`        | Exit 2                             | «Usa un audio de hasta 30 s; se recomiendan ~10 s.»                          |
| `--mic` sin `--duration` en entorno no-TTY | Motor exit `2`        | Exit 2                             | «`--mic` requiere `--duration <segs>` en entornos desatendidos.»             |
| Fallo de hardware de micrófono             | Motor exit `10`       | Exit 10                            | «No se pudo acceder al micrófono: verifica permisos y conexión.»             |
| Nombre inválido                            | Plugin/Motor exit `2` | Exit 2                             | «Usa minúsculas, números, punto, guion o guion bajo.»                        |
| Voz ya existe sin `--force`                | Motor exit `6`        | Exit 6                             | «Elige otro nombre o usa `--force` para reemplazarla.»                       |
| Voz de fábrica                             | Plugin                | Exit 2; no invoca                  | «`default`, `ryan` y `vivian` son voces de fábrica.»                         |
| Voz inexistente en `use`                   | Motor exit `3`        | Exit 3                             | «Consulta `voice list` y elige una voz existente.»                           |
| Label existente en pre-síntesis            | Motor exit `6`        | Éxito idempotente                  | «Ya pre-sintetizado.»                                                        |
| Label o voz ausente en `play`              | Motor exit `3`        | Log en `worker.log`; sin audio     | «Ejecuta `presynth` o revisa la voz activa.»                                 |
| Voz activa eliminada externamente          | `SessionStart`        | `systemMessage`; no arranca daemon | «La voz activa no existe; activa otra con `voice use` o vuelve a `default`.» |
| Borrar voz activa                          | Plugin                | Exit 2; no invoca                  | «Activa otra voz antes de borrar esta.»                                      |
| JSON inválido del motor                    | Plugin                | Exit 1; log                        | «El motor devolvió una respuesta inesperada.»                                |

## 10. Estrategia de pruebas

### 10.1 Unitarias

- `tests/voice.test.ts`
  - normalización de nombres;
  - voces de fábrica;
  - parseo válido e inválido de `voice list --json`;
  - validación conservadora de nombres.
- `tests/config.test.ts`
  - `voice` por defecto;
  - lectura de configs antiguas sin `voice`;
  - persistencia de `voice` sin secretos;
  - valores inválidos → `default`.
- `tests/narrate-ctl.test.ts`
  - argumentos de `voice clone` (archivo y `--mic`), `voice list`, `voice use`, `voice remove`;
  - `voice use` usa `presynth --force` y no escribe config si falla;
  - `voice remove` exige `--yes`, bloquea fábrica y voz activa;
  - `voice clone --force` sobre la voz activa dispara `presynth --force`;
  - `presynth`, `say` y `status` usan la voz activa;
  - mapeo de exit codes.
- `tests/narrate-worker.test.ts`
  - `play` incluye `--voice`;
  - `say` incluye `--voice`;
  - la cola y el lock no cambian.
- `tests/daemon.test.ts`
  - `startDaemonDetached` añade `--warm-voice` cuando se pasa voz.
- `tests/health-check.test.ts`
  - arranca con la voz activa si el daemon está parado;
  - no arranca si la voz activa no existe;
  - emite `systemMessage` de voz ausente;
  - respeta el presupuesto de timeouts.

### 10.2 Integración con CLI falso

Usar el patrón actual de `tests/helpers.ts` y un CLI falso que:

- registre `argv` en un archivo;
- permita programar códigos de salida por comando;
- emita JSON de `voice list`, `voice clone`, `voice remove`;
- simule fallos de pre-síntesis en una etiqueta concreta.

Casos:

1. clonar una voz nueva desde archivo WAV;
2. clonar una voz nueva desde micrófono (`--mic` con y sin `--duration`);
3. nombre ocupado con y sin `--force`;
4. activar una voz y verificar las seis llamadas con `--voice`;
5. fallo de pre-síntesis y rollback de configuración;
6. reproducir y narrar con la voz activa;
7. arrancar el daemon con `--warm-voice`;
8. borrar una voz de usuario;
9. borrar la voz activa: rechazo;
10. voz activa ausente en `SessionStart`;
11. motor sin soporte de `voice`: mensaje de función no disponible.

### 10.3 E2E opcional

Con el motor real, en una máquina de desarrollo:

1. clonar una voz de prueba (desde micrófono o archivo WAV);
2. activarla;
3. verificar que los seis anuncios suenan con esa voz;
4. narrar un `Stop` dinámico;
5. borrar la voz;
6. volver a `default`.

No se ejecuta en CI porque requiere modelos y audio.

### 10.4 Gates

- `npm run lint`
- `npm run format:check`
- `npm run typecheck`
- `npm test`
- `npm run check-dist`
- `claude plugin validate --strict .`
- CI de CircleCI en Linux, Windows y macOS.

## 11. Criterios de aceptación

| ID        | Dado                                               | Cuando                                             | Entonces                                                                                                                                                   |
| --------- | -------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-01** | Una configuración existente sin `voice`            | Se carga la configuración                          | `voice` es `"default"` y todas las rutas siguen funcionando como hoy.                                                                                      |
| **AC-02** | CLI, daemon, WAV válido y nombre libre             | Se ejecuta `voice clone nombre ref.wav`            | Exit 0; el motor recibe `voice clone --name nombre --speech-reference ref.wav --daemon --json`; `config.json` no cambia.                                   |
| **AC-03** | CLI, daemon, micrófono y nombre libre              | Se ejecuta `voice clone nombre --mic --duration 5` | Exit 0; el motor recibe `voice clone --name nombre --mic --duration 5 --daemon --json`; `config.json` no cambia.                                           |
| **AC-04** | Un nombre de voz ya existente                      | Se clona sin `--force`                             | Exit 6, no se sobrescribe y el mensaje ofrece `--force`.                                                                                                   |
| **AC-05** | Un nombre ya existente y `--force`                 | Se clona                                           | El motor recibe `--force`; si la voz es la activa, se ejecuta `presynth --force`; si esa pre-síntesis falla, se informa y no se deja un estado silencioso. |
| **AC-06** | Un nombre de fábrica (`default`, `ryan`, `vivian`) | Se intenta clonar o borrar                         | Exit 2 antes de invocar al motor; no se modifica nada.                                                                                                     |
| **AC-07** | Un WAV inexistente o un nombre inválido            | Se clona                                           | Exit 3 o 2 respectivamente; no se invoca al motor.                                                                                                         |
| **AC-08** | CLI y daemon disponibles                           | Se ejecuta `voice list`                            | Exit 0; se listan todas las voces, marcando la activa y las de fábrica.                                                                                    |
| **AC-09** | Una voz existente y daemon disponible              | Se ejecuta `voice use nombre`                      | Se llama `voice list --json`; se ejecuta `speech synthesize --voice nombre --force` para las seis etiquetas; solo después se persiste `voice`; exit 0.     |
| **AC-10** | Una pre-síntesis falla durante `voice use`         | Se activa la voz                                   | La configuración conserva la voz anterior; exit distinto de 0; se informa la etiqueta fallida.                                                             |
| **AC-11** | Una voz activa configurada                         | Se ejecuta `presynth`                              | Cada `speech synthesize` incluye `--voice <activa> --daemon`; exit 6 cuenta como éxito; `--force` añade `--force`.                                         |
| **AC-12** | Una voz activa configurada                         | El worker narra un evento estático                 | `speech play --label <label> --voice <activa>`; no requiere daemon.                                                                                        |
| **AC-13** | Una voz activa configurada                         | El worker narra un `Stop` dinámico                 | `speech say --text <texto> --voice <activa> --daemon`.                                                                                                     |
| **AC-14** | Una voz activa configurada y daemon parado         | `SessionStart` diagnostica un entorno sano         | El arranque incluye `daemon start --warm-voice <activa>`.                                                                                                  |
| **AC-15** | Una voz activa que no existe                       | `SessionStart`                                     | Se emite `systemMessage`; no se arranca el daemon con la voz ausente; no se muta `config.json`.                                                            |
| **AC-16** | Una voz de usuario no activa                       | Se ejecuta `voice remove nombre --yes`             | Se llama `voice remove --name nombre --yes`; se reportan las locuciones arrastradas; exit 0.                                                               |
| **AC-17** | La voz activa                                      | Se intenta `voice remove`                          | Exit 2 sin invocar al motor; se pide activar otra voz primero.                                                                                             |
| **AC-18** | `voice remove` sin `--yes`                         | Se ejecuta                                         | Exit 2 sin invocar al motor.                                                                                                                               |
| **AC-19** | Una instalación sin clonado                        | Se ejecuta el instalador                           | El flujo es idéntico al actual; no hay preguntas nuevas obligatorias; `default` queda pre-sintetizada.                                                     |
| **AC-20** | Un cambio de texto en el catálogo                  | Se ejecuta `presynth --force`                      | Las seis locuciones se re-sintetizan con la voz activa.                                                                                                    |
| **AC-21** | Un re-clonado del mismo nombre                     | Se ejecuta `voice use nombre`                      | La pre-síntesis forzada actualiza el timbre de las seis locuciones.                                                                                        |
| **AC-22** | Uso normal de la feature                           | Se inspecciona `config.json`                       | No contiene audio, rutas de referencia, claves ni secretos; solo `enabled`, `messageMode` y `voice`.                                                       |
| **AC-23** | Un hook se dispara                                 | Se mide el launcher                                | Sigue por debajo de 100 ms y no ejecuta `voice list`, `voice clone` ni `daemon`.                                                                           |
| **AC-24** | Windows, Linux y macOS                             | Se ejecutan los tests                              | Pasan los mismos casos, incluidas rutas con espacios y shims `.cmd` en Windows.                                                                            |
| **AC-25** | La implementación termina                          | Se ejecutan los gates                              | `lint`, `format:check`, `typecheck`, `test` y `check-dist` pasan; `claude plugin validate --strict .` pasa; CI verde.                                      |
| **AC-26** | La implementación termina                          | Se revisa la documentación                         | `docs/INTEGRATION.md`, `README.md`, `SECURITY.md`, `CHANGELOG.md` y este documento reflejan la feature y las nuevas superficies.                           |
| **AC-27** | Un motor sin soporte de `voice`                    | Se invoca la feature                               | El plugin informa que no está disponible y no rompe la narración con `default`.                                                                            |

## 12. Documentación afectada

| Documento                     | Cambio                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `docs/specs/VOICE_CLONING.md` | Este documento.                                                                                           |
| `docs/INTEGRATION.md`         | Nuevas superficies, flags `--voice`/`--warm-voice`, códigos de salida y requisitos.                       |
| `README.md`                   | Ejemplo de `config.json` con `voice`; comandos de voz; privacidad.                                        |
| `SECURITY.md`                 | La referencia de voz es local; el plugin no la copia ni la envía a la nube.                               |
| `CHANGELOG.md`                | Entrada de la feature.                                                                                    |
| `commands/install.md`         | Paso opcional de clonado y activación.                                                                    |
| `commands/voice.md`           | Nuevo comando de usuario.                                                                                 |
| `skills/narrate/SKILL.md`     | Intenciones de voz y enrutamiento a `narrate-ctl`.                                                        |
| `docs/ROADMAP.md`             | Retirar la idea de perfiles de voz si se implementa esta fase; dejar los perfiles por evento como futuro. |

## 13. Riesgos y trabajo futuro

### Riesgos

- **Costo de `presynth --force`**: seis síntesis por cambio de voz. Es una
  operación manual y poco frecuente; se acepta a cambio de consistencia.
- **Cold-start del daemon al cambiar de voz**: el residente es de una sola voz;
  la primera síntesis tras un cambio externo puede tardar. La pre-síntesis lo
  mitiga.
- **Re-clonado del mismo nombre**: si el usuario reemplaza una voz activa, las
  locuciones viejas quedan obsoletas hasta `presynth --force`. El flujo lo
  automatiza, pero un fallo deja un estado que hay que reparar.
- **Borrado destructivo**: `voice remove` arrastra las locuciones. La
  confirmación y la protección de la voz activa son obligatorias.
- **Deriva del contrato del motor**: las superficies de voz no estaban en el
  contrato estable del plugin; hay que documentarlas y verificarlas.
- **Modelo Base**: el clonado y las voces clonadas requieren
  `qwen3-tts-0.6b-base`; sin él, el motor sale con exit 4.
- **Permisos de micrófono**: al clonar con `--mic`, si el sistema operativo no concede permisos al proceso del motor, sale con exit 10. La UX debe informar con claridad cómo conceder permisos o usar un archivo WAV alternativo.

### Trabajo futuro

- Perfiles de voz por evento.
- Varias voces activas por perfil o por proyecto.
- Limpieza automática de locuciones de voces retiradas.
- Previsualización de voz antes de activarla (`voice test`).
- Fallback controlado a `default` si la voz activa desaparece.
- Verificación de versión del motor antes de habilitar la feature.

## 14. Referencias

- `docs/INTEGRATION.md` — contrato actual del plugin con el motor.
- `README.md` — configuración, privacidad y comandos.
- `SECURITY.md` — modelo de amenazas y credenciales.
- Motor: `docs/CLI/CONTRACT.md` §3, §5 y §12.
- Motor: `docs/CLI/commands/VOICE.md` — `voice clone`, `voice list`, `voice remove`.
- Motor: `docs/CLI/commands/SPEECH.md` — `speech synthesize`, `speech say`, `speech play`.
- Motor: `docs/CLI/commands/DAEMON.md` — `--warm-voice` y residente de una sola voz.
- Motor: `docs/DESIGN.md` — clonación por huella de timbre y modelo Base.
