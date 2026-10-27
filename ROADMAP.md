# Roadmap — Agent Voice-InterConnector

> Versión actual: **0.1.0** → Próximo release: **0.2.0** (sync con motor v0.36.2)
> Versionado independiente del motor; salto a `1.0.0` cuando el motor alcance `v1.0.0`.

---

## ✅ Completado (v0.1.0 → 0.2.0)

- [x] **Renombrado**: `tts-sidecar-narrator` → `Agent Voice-InterConnector` (namespace, install id, state dir, labels `voice-*`)
- [x] **Licencia**: GPL-3.0 → MPL-2.0 (paridad con motor)
- [x] **Migración CLI motor**: `speak` → `speech say --daemon` (fix fallo silencioso exit 2)
- [x] **UserPromptSubmit**: acuse fijo pre-sintetizado (`voice-user-prompt-submit`), sin LLM en ruta caliente
- [x] **Anuncios estáticos**: catálogo único en `static-announcements.ts`, labels semánticos fijos, reproducción vía `speech play`
- [x] **CI gate manifiestos**: `validate-manifest` job con `claude plugin validate --strict`
- [x] **Subcomando `presynth`**: idempotente, `--force` para re-sintetizar
- [x] **Sync documental v0.36.2**: 13 ubicaciones actualizadas, README reestructurado, drift eliminado

---

## 🎯 Próximo ciclo (0.2.x — mejoras incrementales)

### Estabilidad y robustez
- [ ] **Health-check más granular**: distinguir `model_missing` (exit 4) vs `daemon_unreachable` (exit 5) en aviso SessionStart
- [ ] **Retry automático daemon start** en health-check si `warming` → `warm_failed` (backoff exponencial, max 3 intentos)
- [ ] **Timeouts configurables** por hook (hoy hardcoded 10s/30s en hooks.json)

### Experiencia de usuario
- [ ] **`narrate-ctl test`**: smoke test audible sin sesión Claude (ejecuta las 5 superficies en modo local)
- [ ] **Modo `verbose` en narrate-ctl**: loguear proveedor usado (local/llm), tokens, latencia
- [ ] **Comando `doctor` del plugin**: valida CLI motor, modelos, daemon, claves, config.json en una pasada

### Configuración
- [ ] **Perfiles de voz por hook**: `voice-stop`, `voice-notification`, etc. configurables (hoy fijos en catálogo)
- [ ] **Umbral de oraciones `Stop` local** configurable (hoy 2, hardcoded en `clampSentences`)
- [ ] **Filtro de hooks activos**: desactivar superficies individuales sin editar hooks.json

---

## 🔮 Dirección media (0.3.x — capacidades nuevas)

### Narración enriquecida
- [ ] **Contexto de proyecto**: inyectar `cwd`, branch, últimos archivos modificados en prompt LLM (opt-in)
- [ ] **Narración de diffs**: `Stop` resume qué cambió (archivos, ±líneas) en modo local determinista
- [ ] **Anuncios dinámicos**: `Notification` incluye tipo de permiso (bash/read/write) en el texto

### Integración motor
- [ ] **Streaming TTS**: `speech say --stream` → reproducir mientras sintetiza (latencia percibida ↓)
- [ ] **Clonación de voz del usuario**: `voice clone --name mine` → usar en anuncios (requiere motor ≥ v0.37)
- [ ] **Evento `started.operation`**: mostrar operación en curso (síntesis/clonación/doblaje) en status

### Marketplace y distribución
- [ ] **Publicar en marketplace Claude.ai**: validar `marketplace.json`, ícono, screenshots
- [ ] **Auto-update notificación**: avisar en SessionStart si hay versión nueva del plugin en marketplace
- [ ] **Homebrew tap / Scoop bucket**: instalación nativa sin clonar repo

---

## 🧭 Ideas en incubación (sin compromiso de versión)

| Idea | Complejidad | Valor | Bloqueantes |
|------|-------------|-------|-------------|
| TTS local fallback (piper/coqui) si motor caído | Alta | Offline total | Bundle size, licensing |
| Narración multi-idioma (detectar idioma del turno) | Media | Equipos distribuidos | Motor soporta cross-lingual |
| Hook `PreToolUse` / `PostToolUse` para narrar herramientas | Baja | Observabilidad | Ruido potencial alto |
| Web dashboard de métricas (latencia, proveedor, errores) | Media | Debugging | Privacy, storage |
| Plugin como extensión VS Code (independiente de Claude) | Alta | Alcance | Arquitectura distinta |

---

## 📋 Criterios de aceptación para `1.0.0` (alineado con motor v1.0.0)

- [ ] Motor en `v1.0.0` publicado y estable
- [ ] Plugin sin deprecations ni APIs experimentales
- [ ] Smoke test E2E automatizado en CI (Linux/Windows/macOS)
- [ ] Documentación completa: usuario, desarrollador, arquitectura
- [ ] Publicado en marketplace Claude.ai con validación estricta
- [ ] Changelog limpio: cada entrada vincula a PR/issue

---

## 🗂️ Historial de decisiones descartadas

| Decisión | Motivo | Fecha |
|----------|--------|-------|
| Modo `prompt` LLM (buildPromptMessage) | Divergencia semántica + latencia | 2026-10 (v0.2.0) |
| `speak` command alias | Eliminado en motor sin alias; fallo silencioso | 2026-10 (v0.2.0) |
| Health-check bloqueante en SessionStart | Bloquea inicio de sesión; diseño no intrusivo | 2026-07 (v0.1.0) |
| Un solo anuncio genérico para todo | Pérdida de contexto semántico | 2026-10 (v0.2.0) |

---

> **Convención**: cada release mueve items completados a ✅, descarta a 🗂️, y promueve de 🔮 → 🎯 según capacidad real. El roadmap vive en el repo y se actualiza en cada release (ver `docs/RELEASING.md` §Después del tag).