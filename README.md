# Reto 02 · Agente conversacional "Registro de Contratos Vigentes"

Agente que lee un buzón único de correos con contratos adjuntos, extrae y valida los datos,
registra los contratos limpios en el maestro, pide confirmación humana para los dudosos y
termina con un reporte de alertas. Front de chat + backend + herramientas tipadas con `zod`.

## Requisitos

- Node.js **≥ 22.18** (se usa TypeScript nativo, sin build). Probado con Node 24.
- npm. (Bun también funciona: `bun install && bun run dev`.)

## Arranque en local (un comando)

```bash
npm install
npm run dev
```

Abre <http://localhost:3000>. Sin `LLM_PROVIDER` configurado el agente usa un adaptador
**mock determinista** que reproduce el flujo completo sin clave de ningún proveedor.

Producción (mismo código):

```bash
npm start
```

### Con un modelo real

```bash
copy .env.example .env       # Windows
# cp .env.example .env       # macOS / Linux
```

| Variable | Obligatoria | Descripción |
|---|---|---|
| `LLM_PROVIDER` | No (=`mock`) | `mock` \| `openai` \| `anthropic` |
| `LLM_API_KEY` | Sí con proveedor real | Clave del proveedor. Solo vive en el backend. |
| `LLM_BASE_URL` | No | Endpoint compatible (OpenAI, Ollama, LM Studio, proxy…) |
| `LLM_MODEL` | No | Modelo a usar (`gpt-4o-mini`, `claude-sonnet-4-5`, …) |
| `LLM_TIMEOUT_MS` | No (=60000) | Timeout por petición al proveedor |
| `AGENT_MAX_ITERACIONES` | No (=25) | Tope de iteraciones herramienta → modelo por turno (CA1) |
| `AGENT_MAX_TOKENS_SESION` | No (=200000) | Tope de tokens por sesión |
| `PORT` | No (=3000) | Puerto del servidor |

La clave nunca se expone en el front, en los logs ni en la API (`GET /api/health` solo
devuelve proveedor y modelo).

## Demostración sin modelo

```bash
npm run demo
```

Limpia `out/`, procesa los 6 mensajes del buzón con `hoy = 2026-09-03`, hace una segunda
pasada con `confirmado: true` y verifica **36 comprobaciones** de la sección 7.4 del PRD
(clasificación por mensaje, campos en revisión, escritura en el maestro, historial,
documentos archivados y las tres secciones de alertas). Sale con código ≠ 0 si algo falla.

## Prompt de prueba (sesión nueva en el chat)

```
Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que
esté limpio, muéstrame lo que requiere revisión campo por campo y termina
con el reporte de alertas. No registres nada dudoso sin preguntarme.
```

Resultado esperado: tabla por mensaje con clasificación y acción, llamadas a herramientas
visibles en el chat, detalle de `msg-006` (valor y `fecha_fin` en revisión) y el resumen de
`out/alertas.md`. Después de **"Confirmo el valor 0 y la fecha fin 2027-08-31"** (o simplemente
`confirmo`), `msg-006` queda registrado como `CM-2026-03` y las alertas se regeneran.

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message, hoy? }` → `{ reply, toolCalls[], needsConfirmation, iteraciones }` |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión (mensajes, tool calls, pendiente, tokens) |
| `GET` | `/api/health` | `{ ok, provider, model, maxIteraciones }` sin exponer claves |
| `GET` | `/api/estado` | Maestro, procesados, historial, pendiente y últimas 50 líneas de `out/log.jsonl` |
| `GET` | `/api/alertas` | Contenido de `out/alertas.md` |
| `GET` | `/` | Front de chat (`web/`) |

## Estructura

```
reto-02/
├── agent/prompt.md                 # comportamiento (system prompt)
├── src/
│   ├── server.ts                   # API HTTP + ciclo del agente
│   ├── agent/                      # session, registry (zod→JSON Schema), cycle (CA1..CA5)
│   ├── llm/                        # adapter + mock / openai-compatible / anthropic
│   ├── tools/contratos.ts          # 6 herramientas (cada export → contratos_<export>)
│   ├── knowledge/registro-contratos.md  # conocimiento del proceso
│   └── lib/                        # extracción, validación, registro, alertas, CSV, fechas
├── web/                            # front de chat (HTML/CSS/JS sin dependencias)
├── modulo/                         # bonus 9.4 (generado, no editar a mano)
├── fixtures/                       # datos de entrada (solo lectura)
├── out/                            # maestro de trabajo, documentos, alertas, logs
├── demo.ts                         # verificación sin modelo
├── scripts/sync-modulo.ts          # regenera modulo/
├── SOLUCION.md
└── PRD.md
```

Separación evaluada: **comportamiento** en `agent/prompt.md`, **conocimiento** en
`src/knowledge/`, **ejecución** en `src/tools/`.

## Módulo reutilizable (bonus 9.4)

```bash
npm run sync-modulo
```

Genera `modulo/` con `agent.md` (frontmatter `mode: primary` y `permission: {edit: deny, bash: deny}`),
`tools/contratos.ts` y `skill/registro-contratos/SKILL.md`, copiados desde la misma fuente que
usa la aplicación (sin divergencias). Ver `modulo/README.md`.

## Despliegue con Docker

```bash
docker compose up --build     # o: docker build -t reto-02 . && docker run -p 3000:3000 reto-02
```

Expone el puerto 3000. Para usar un modelo real, inyecta las variables de entorno
(`-e LLM_PROVIDER=openai -e LLM_API_KEY=...`) o monta un `.env`.

## Verificación

| Comando | Qué hace |
|---|---|
| `npm run typecheck` | `tsc --noEmit` sobre `src/`, `scripts/`, `modulo/` y `demo.ts` |
| `npm run demo` | Demostración determinista con 36 comprobaciones |
| `npm run sync-modulo` | Regenera `modulo/` desde la fuente |

## Link de prueba

No hay despliegue público: la demo se corre en local durante la defensa con
`npm install && npm run dev` (<http://localhost:3000>). El contenedor Docker deja el
servicio levantado en menos de 2 minutos en una máquina limpia.
