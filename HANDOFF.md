# HANDOFF — Reto 02 "Registro de Contratos Vigentes"

Documento de continuidad para cualquier modelo/asesor. Resume el plan aprobado, las decisiones
tomadas y el estado de la solución. Si retomas este repo, lee esto primero y luego `PRD.md`.

## Contexto

- Repo: `reto-02/` (Node v24, TypeScript nativo con type stripping, **sin Bun**; git 2.54).
- PowerShell bloquea `npm.ps1` → usar `npm.cmd`. En `tsconfig` no se usan enums/namespaces/
  parameter properties; imports relativos con extensión `.ts` (`allowImportingTsExtensions` +
  `rewriteRelativeImportExtensions`).
- Dependencias: `zod@^4` (obligatorio), `typescript`, `@types/node`. Nada más.
- Idioma de respuesta, docs y UI: español.
- Fixtures UTF-8 en `fixtures/reto-02/` (solo lectura). Escrituras en `out/`.
- Entregables PRD: app (front + backend + herramientas + adaptador LLM + prompt en archivo),
  `demo.ts` sin modelo, `SOLUCION.md`, `README.md`, link de prueba, bonus `modulo/` (+10),
  `Dockerfile` portátil. Aprobación 70/100.

## Decisiones aprobadas por el usuario

1. **LLM sin clave**: proveedor `mock` determinista por defecto + adaptadores `openai` (compatible)
   y `anthropic` intercambiables. `.env.example` con `LLM_PROVIDER=mock`.
2. **Front**: HTML plano + JS (`web/`), sin frameworks.
3. **Despliegue**: entregar `Dockerfile` portable (decisión de plataforma pendiente del usuario).
4. **Bonus 9.4 sí**: `modulo/` generado por `scripts/sync-modulo.ts` (misma fuente, sin divergencia).

## Arquitectura implementada

```
src/lib/       paths, texto, fechas, csv, tipos(zod), log, buzon, extraccion,
               maestro, validacion, alertas
src/tools/     contratos.ts  → 6 herramientas (export = contratos_<export>)
src/agent/     registry (zod→JSON Schema, validación de args, gate CA3), session, cycle
src/llm/       adapter (interfaz), mock (determinista), openaiCompatible, anthropic
src/server.ts  API HTTP: POST /api/chat, GET /api/sessions/:id, GET /api/health + estáticos
agent/prompt.md                comportamiento (system prompt)
src/knowledge/registro-contratos.md  conocimiento del proceso
web/             index.html, app.js, styles.css
demo.ts          6 mensajes + 2ª pasada con confirmado:true + alertas + asserts §7.4
modulo/          agent.md, tools/contratos.ts, skill/registro-contratos/SKILL.md (generados)
```

Contrato de herramientas (PRD §6.2): objeto `{ description, args (zod con .describe()),
execute(args, ctx) → string JSON { ok:true, data } | { ok:false, error } }`, **nunca lanza**.
`ctx = { directory, sessionId, hoy? }`; rutas siempre relativas a `ctx.directory`.

## Reglas de negocio / ciclo (resumen operativo)

- RN1 duplicado = mismo `id_contrato` + mismo `valor`+`fecha_inicio`+`fecha_fin` → sin escritura.
- RN2 actualización = mismo id (o mismo `nit_cliente` + objeto con similitud ≥0.9) con algún
  campo distinto, o el documento es otrosí → merge + `historial.jsonl`.
- RN3 nuevo / RN4 rechazado (sin contrato identificable: cláusulas numeradas + partes).
- RN5 confianza < 0.8 → `requiere_revision`; `registrar` exige `confirmado:true`.
  Conflictos con el maestro: campo con confianza < 0.9 que difiere de la fila existente
  (solo aplica cuando la clasificación es `actualizacion`; por eso msg-003 no pide revisión).
- RN6 fixture solo lectura; se copia a `out/sharepoint/` en la primera ejecución.
- RN7 toda ejecución de herramienta escribe `out/log.jsonl { ts, herramienta, mensaje_id, ok, resumen }`.
- CA1 tope 25 iteraciones/turno (`AGENT_MAX_ITERACIONES`), CA2 el modelo no afirma valores:
  validar/registrar **recalculan la extracción canónica desde disco** y solo aceptan valores
  distintos si `confirmado:true` (corrección manual), CA3 gate en registry: `confirmado:true`
  solo si existe `session.pendiente` para ese `mensaje_id`, CA4 tool calls visibles + log,
  CA5 errores `{ok:false}` no matan la sesión.
- Límite de tokens por sesión (`AGENT_MAX_TOKENS_SESION`).

## Matriz de confianza (extracción determinista)

0.95 dato literal en cláusula · 0.85 inferido (país, remitente resuelto, moneda por mención de
"pesos") · 0.8 fecha_inicio derivada de correo y ausencia de cláusula de póliza · 0.7 fecha_fin
derivada de plazo · 0.6 valor indeterminado · 0 ausente (null, nunca inventado).

Campo en alcance = los 12 campos de datos de §7.2 (id_contrato…estado_poliza). `comercial`,
`ruta_sharepoint`, `fecha_registro`, `fuente` son administrativos → **no entran** a
`requiere_revision` (un remitente desconocido va en `advertencias`). `tipo_poliza` sale del
alcance si `requiere_poliza === false`. En otrosí solo entran los campos modificados (el resto
es `null` y se hereda del maestro).

## Reglas de extracción (fixtures)

- Cláusulas: segmentos que arrancan con `PRIMERA.`…`OCTAVA.` (multiline). Encabezado = primeros
  ~60 chars; `VALOR`/`PLAZO`/`OBJETO` definen el alcance de cada dato.
- `valor` solo de la cláusula que menciona VALOR y tiene un importe `(COP $265.000.000)`,
  `(USD 120,000.00)`, `(PEN 520,000.00)` → `parseNumero` maneja `265.000.000` y `120,000.00`.
  Así se evita el `(COP $100.000.000)` de GARANTÍAS en msg-006.
- "no tiene un valor determinado" → `valor=0`, `valor_indeterminado=true`, conf 0.6, y la
  moneda se infiere de "pesos"/COP en el texto (0.85).
- Fechas: `desde X hasta Y` en cláusula PLAZO; si no hay, `fecha_inicio = día siguiente a la
  fecha del correo` (ex die, cuando la firma solo indica mes) con conf 0.8, y
  `fecha_fin = addMonths(fecha_inicio, N) − 1 día` con conf 0.7 (`N` de `"(12) meses"`).
  Convención verificada contra msg-001/002/004 (fechas explícitas coinciden con la fórmula).
- `cliente`: `Entre [los suscritos,] <RAZÓN SOCIAL>, identificada con|, NIT|RUC` → `titulo()`
  (preposiciones en minúscula, sufijos legales `S.A.S./S.A./S.A.C./S. de R.L.` en mayúsculas).
- `nit_cliente`: primer `NIT|RUC` del **segmento de la primera parte** (antes de "PERIFERIA
  IT GROUP") → `limpiarIdentificador` (quita puntos; si hay `-` conserva lo anterior al guion).
- `pais`: keywords de la primera parte (Bogotá/Medellín/Barranquilla→CO, Quito→EC, Lima→PE,
  Panamá→PA, Tegucigalpa→HN); fallback RUC 13→EC, 11→PE; `NIT`→CO.
- `objeto`: cláusula OBJETO, quitando el prefijo "EL CONTRATANTE/EL CONTRATISTA se obliga a /
  prestará…", máx. 200 chars.
- `requiere_poliza`: true si hay cláusula GARANTÍAS que exige póliza o el cuerpo del correo lo
  dice (0.95); false por ausencia de cláusula (0.8). → `estado_poliza` = `pendiente` (nuevo con
  póliza) / `no_aplica` (sin póliza). En actualización no se degrada `vigente`.
- `es_contrato`: partes ("ENTRE LOS SUSCRITOS"/"EL CONTRATANTE") y ≥2 encabezados de cláusula
  (OBJETO/VALOR/PLAZO). msg-005 (cotización) → `es_contrato:false` + motivo → `rechazado`.

## Resultados esperados §7.4 (asserts de demo.ts, hoy = 2026-09-03)

| msg | esperado |
|---|---|
| 001 | `nuevo`, registrado, `estado_poliza=pendiente`, ruta `Contratos/2026/industrias-delta/CT-2026-015.txt` |
| 002 | `nuevo`, registrado, `no_aplica`, CT-2026-016 (nit = CT-2026-007 pero objeto distinto) |
| 003 | `actualizacion` de CT-2026-011: valor 520000, fecha_fin 2027-11-01 + `historial.jsonl`; sin revisión |
| 004 | `duplicado` (CT-2026-012), sin escritura |
| 005 | `rechazado` (cotización) |
| 006 | `nuevo` con `requiere_revision=["valor","fecha_fin"]` (0.6/0.7), **sin registrar**; 2ª llamada `confirmado:true` → valor 0, fecha_fin 2027-08-31, fecha_inicio 2026-09-01, comercial `""` + advertencia de remitente desconocido, `requiere_poliza=true` (cláusula GARANTÍAS) → `pendiente` |

Maestro final: 8 filas fixture + 3 (001, 002, 006) = 11. `procesados.json` = 6 ids.
`fecha_registro = max(hoy, fecha_del_correo)` para que la sección 3 de alertas muestre ≥
2026-05-30. Alertas con `hoy=2026-09-03`: ventana 2026-09-03…2026-11-02 → CT-2026-004 (42 d),
CT-2026-009 (27 d); nota de vencidos CT-2025-018, CT-2026-002; pólizas pendientes CT-2026-004,
CT-2026-015 (+CM-2026-03 tras confirmar); gap = 3 nuevos.

## Salidas en `out/`

`sharepoint/maestro-contratos.csv` (RFC4180 propio, columnas intactas),
`sharepoint/Contratos/<año_inicio>/<slug>/<id>.txt` (extensión = adjunto original; en
actualización se archiva el documento como `<id>_<mensaje_id>.txt` y la fila conserva la ruta
original), `sharepoint/historial.jsonl {ts, id_contrato, accion, cambios[], mensaje_id,
ruta_documento?}`, `log.jsonl`, `procesados.json` (array de ids; NO se marca si queda pendiente
de revisión), `alertas.md` (3 secciones), `sessions/<id>.json`.

## Mock LLM (`src/llm/mock.ts`)

Máquina de estados determinista que lee el historial (resultados de herramientas en JSON):
saludo si el mensaje no tiene palabras clave → `leer_buzon` → por cada mensaje `extraer` →
`validar` → `registrar(confirmado:false)` → `alertas` → respuesta final con tabla markdown +
pregunta explícita si hay pendiente (CA3) = **21 iteraciones** en el turno 1. Si el mensaje del
usuario contiene "confirmo…": `registrar(confirmado:true)` → `alertas` (refresco) → resumen
(turno 2: 3 iteraciones). Parsea `fecha de hoy YYYY-MM-DD` del mensaje.

## Cómo verificar

```bash
npm.cmd install
npm.cmd run typecheck
npm.cmd run demo        # asserts §7.4, sale con código 1 si algo falla
npm.cmd run dev         # server en :3000 con LLM_PROVIDER=mock
npm.cmd run sync-modulo # regenera modulo/ desde fuentes
```

## Estado

**COMPLETADO y verificado** (typecheck en verde, demo 36/36, servidor HTTP probado):

- `npm.cmd run typecheck` → sin errores.
- `npm.cmd run demo` → **36/36 comprobaciones** (§7.4 completa + alertas + RN7).
- `npm.cmd run sync-modulo` → `modulo/` con 19 archivos.
- Servidor probado por HTTP: `GET /`, `/api/health`, `/api/sessions/:id`, `/api/estado`,
  `/api/alertas`; `POST /api/chat` con flujo completo de 2 turnos → 11 filas, 6 procesados,
  pendiente limpio.
- Escritos: `src/**`, `web/**`, `demo.ts`, `agent/prompt.md`, `src/knowledge/`,
  `scripts/sync-modulo.ts`, `modulo/`, `README.md`, `SOLUCION.md`, `Dockerfile`,
  `docker-compose.yml`, `.dockerignore`.

### Correcciones aplicadas durante la verificación (no reintroducir)

1. **Mojibake en `src/lib/extraccion.ts`**: los regex/strings contenían bytes doblemente
   codificados (`OTROS[ÃI]`, `GARANT[ÃI]AS`, `bogot[Ã¡a]`, `p[Ã³o]liza`, clase `[A-ZÁÉÍÓÚÑ]`…)
   y por eso no matcheaban los fixtures (UTF-8 correcto). Se repararon los 38 pares `Ã?`/`Â?`
   (incl. bytes CP1252 0x89/0x91/0x93/0x9A) y se quitó el BOM. Si aparece `Ã`/`Â`/`â€` en un
   `.ts`, es un error de codificación.
2. **`\b` no sirve después de una letra acentuada**: `/^OTROS[ÍI]\b/` nunca matchea "OTROSÍ"
   (Í no es `\w`). Se cambió a `/^OTROS[IÍ]/`.
3. **`fechaDeISO`** usaba `\b` final: `"2026-08-31T17:50"` no tiene borde entre `1` y `T` →
   devolvía `null` y msg-006 perdía `fecha_inicio`/`fecha_fin`. Ahora `(\d{4}-\d{2}-\d{2})(?!\d)`.
4. **`new leerProcesadosSet(...)`** (función llamada con `new`) y `aCsv` rompía con
   booleanos/números → `escapar(valor: unknown)` con `String()`.
5. **Documentos de actualización**: la copia usa la extensión real del adjunto
   (`CT-2026-011_msg-003.txt`), no la extensión original `.pdf` de la fila.
6. **Variables de entorno**: el código lee `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL`,
   `LLM_MODEL`/`LLM_MODELO`, `LLM_TIMEOUT_MS`, `AGENT_MAX_ITERACIONES`, `AGENT_MAX_TOKENS_SESION`,
   `PORT` mediante `env()` (trata `""` como ausente — importante para docker-compose).
7. **Endpoints**: `/api/sessions/:id` (alias `/api/sesion/:id`) y `/api/health` como exige §6.4;
   el front usa `/api/sessions/`.
8. **Objeto**: se quita el prefijo "EL CONTRATANTE **o EL CONTRATISTA** se obliga a/prestará…".
9. **Mock**: tras confirmar, refresca `contratos_alertas` antes del resumen (los conteos no se
   quedan con los del turno anterior); flujo completo = 21 iteraciones en turno 1, 3 en turno 2.
10. **Fecha de referencia (`hoy`)**: `ejecutarTurno` añade al ÚLTIMO mensaje de usuario (copia
    saliente, no persistida) `Fecha de hoy: <ctx.hoy>` cuando `ctx.hoy` está definido y el texto
    no la menciona; `fechaObjetivo()` del mock solo acepta `fecha de hoy YYYY-MM-DD` (antes
    tomaba el primer `YYYY-MM-DD` del mensaje, así que "confirmo … fecha fin 2027-08-31"
    usaba 2027 como `hoy` y escribía `out/alertas.md` con la fecha del día real). Con esto el
    campo `hoy` del body (front/API) y el de `demo.ts` rigen también el turno 2.

### Pendiente / degradaciones conscientes

- **Link público (§9.3)**: no hay despliegue; se corre en local/docker en la defensa (−10 asumido).
- Streaming (opcional), OCR para PDF escaneados, autenticación: no hechos (documentado en
  `SOLUCION.md` §9).
- `contratos_leer_pdf` solo descomprime streams con texto (no extrae PDFs con cifrado/xref roto).
- Para cambiar de proveedor real: `.env` con `LLM_PROVIDER=openai|anthropic` + `LLM_API_KEY`.
