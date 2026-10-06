# SOLUCIÓN · Reto 02 · Registro de Contratos Vigentes

## 1. Problema en una frase

Los comerciales envían contratos y otrosíes por correo a un buzón único, y alguien los digita
a mano en un maestro que termina desactualizado; **duele a Operaciones y a Finanzas**, porque
si el maestro no está al día no se sabe qué contratos vigentes hay, qué pólizas vencen y qué
se puede facturar.

## 2. Arquitectura

```
┌──────────────────────┐  POST /api/chat   ┌────────────────────────────────────────────┐
│  web/ (chat)         │ ────────────────▶ │  src/server.ts                             │
│  historial           │                   │   └─ src/agent/cycle.ts  (CA1..CA5)        │
│  tool calls visibles │ ◀──────────────── │       ├─ agent/prompt.md   (comportamiento) │
│  banner de           │  { reply,         │       ├─ src/knowledge/…   (conocimiento)   │
│  confirmación        │   toolCalls,      │       ├─ agent/registry.ts (zod → schema)   │
└──────────────────────┘   needsConfirm.}  │       ├─ agent/session.ts  (archivo JSON)   │
                                           │       └─ src/llm/adapter.ts (proveedor)     │
                                           │              ├─ mock.ts (sin clave)         │
                                           │              ├─ openaiCompatible.ts         │
                                           │              └─ anthropic.ts                │
                                           └───────────┬───────────────────┬─────────────┘
                                                  src/tools/contratos.ts  src/lib/*
                                                  (6 herramientas zod)    extracción ·
                                                         │                validación ·
                                                         ▼                registro · alertas
                                          fixtures/ (solo lectura)   out/ (escritura)
                                          buzon/ maestro CSV          maestro, sharepoint,
                                                                     alertas.md, log.jsonl
```

- **Comportamiento** → `agent/prompt.md` (archivo aparte, no embebido en código).
- **Conocimiento** → `src/knowledge/registro-contratos.md` (columnas, confianzas, convención de
  fechas, alertas, flujo de confirmación). El prompt y el conocimiento se concatenan al armar
  el system prompt (`src/agent/prompt.ts`).
- **Ejecución** → `src/tools/contratos.ts`: cada export es una herramienta `<archivo>_<export>`
  con `description`, `args` (zod con `.describe()`) y `execute(args, ctx)` que **nunca lanza** y
  devuelve `{ ok, data }` o `{ ok, error }`. El registro (`agent/registry.ts`) genera el JSON
  Schema con `z.toJSONSchema`, valida argumentos antes de ejecutar y devuelve el error al modelo.
- El módulo de reglas de negocio vive en `src/lib/` (extracción, validación, registro, alertas)
  y **no importa** ni al servidor ni al modelo: por eso `demo.ts` puede correr sin clave.

## 3. Ciclo del agente

`src/agent/cycle.ts` implementa el bucle a mano (sin framework):

1. Carga la sesión (`out/sessions/<id>.json`: mensajes, tool calls, pendiente, tokens).
2. `POST` → agrega el mensaje del usuario → `while iteraciones < tope`:
   - arma `[{system}, …historial]`, llama `adaptador.enviar(mensajes, herramientas)`;
   - sin tool calls → responde y cierra el turno;
   - con tool calls → cada una se valida con zod, se ejecuta, se guarda en el historial de la
     sesión (CA4) y se responde con el JSON (`role: tool`);
   - si una herramienta falla, el error se le devuelve al modelo: **la sesión no muere** (CA5).
3. **CA1**: si se alcanza el tope (`AGENT_MAX_ITERACIONES`, 25), se hace **una última llamada sin
   herramientas** pidiendo resumir "lo que tengo y lo que falta"; si esa llamada falla, se
   responde con un mensaje fijo de tope. Nunca se queda colgado.
4. **CA2**: el modelo solo puede afirmar valores que salieron de una herramienta; el prompt lo
   prohíbe y el diseño lo hace innecesario (la extracción y el maestro se recalculan en cada
   llamada, el modelo no escribe nada).
5. **CA3 (confirmación humana)**: la validación vive en `src/lib/registro.ts`. Si
   `requiere_revision` no está vacío y `confirmado !== true`, `contratos_registrar` devuelve
   `{ ok:false, error:"requiere revisión: …" }`, **no escribe** y la sesión guarda el pendiente
   (`mensaje_id` + campos). El gate se cumple **en código**: `contratos_registrar` rechaza
   `confirmado: true` si no existe un pendiente para ese `mensaje_id`, de modo que el modelo no
   puede saltarse la confirmación aunque lo intente.
6. Tope de costo: `AGENT_MAX_TOKENS_SESION` por sesión; si se supera, el turno responde con un
   mensaje claro y pide abrir sesión nueva.

## 4. Elección del modelo

| Proveedor | Implementación | Estado |
|---|---|---|
| **`mock`** (por defecto) | `src/llm/mock.ts`: máquina de estados determinista que recorre el historial y decide la siguiente tool call | Usado en `npm run demo` y en el arranque sin `.env` |
| OpenAI o compatible | `src/llm/openaiCompatible.ts` (`/chat/completions`, `tools`, `tool_calls`) | Listo: `LLM_PROVIDER=openai` |
| Anthropic | `src/llm/anthropic.ts` (`/v1/messages`, `tool_use`/`tool_result`) | Listo: `LLM_PROVIDER=anthropic` |

- **Por qué**: la interfaz propia `enviar(mensajes, herramientas) → respuesta` obliga a que cambiar
  de proveedor no toque el ciclo (requisito 6.1). Se eligió el estándar *OpenAI-compatible* porque
  cubre OpenAI, Ollama, LM Studio y proxies con un solo adapter.
- **Modelo sugerido**: `gpt-4o-mini` (barato y suficiente: el modelo solo decide *qué* herramienta
  llamar y redacta la respuesta; los valores salen de las herramientas).
- **Costo estimado por caso** (6 mensajes, 2 turnos ≈ 24 llamadas al modelo):
  ~35k tokens de entrada y ~4k de salida → con `gpt-4o-mini` (USD 0,15 / 1M in, 0,60 / 1M out)
  ≈ **USD 0,01 por caso procesado**; con un modelo de gama media ≈ USD 0,06. El mock cero.
- Si no hay clave, el agente responde indicando que falta `LLM_API_KEY` y sugiriendo el mock (CA5).

## 5. Estrategia de extracción

Todo es **determinista y por reglas** (`src/lib/extraccion.ts`); el modelo nunca extrae valores.

1. **¿Es contrato?** Presencia de "ENTRE LOS SUSCRITOS" (o CONTRATANTE + CONTRATISTA) **y**
   ≥ 2 cláusulas numeradas con OBJETO/VALOR/PLAZO. Si no → `es_contrato: false` con motivo (RN4).
2. **Cláusulas**: se divide por ordinales (`PRIMERA.`, `SEGUNDA.`, …) y se localiza OBJETO /
   VALOR / PLAZO / GARANTÍAS por encabezado.
3. **Valor**: patrón `(COP|USD|PEN|PAB|HNL $265.000.000)`; si la cláusula dice "no tiene un valor
   determinado" → `valor 0` con `valor_indeterminado` y confianza 0.60.
4. **Plazo y fechas**: `desde X hasta Y` → fechas directas (0.95). Solo "N meses" →
   `fecha_inicio = ancla + 1 día` (ancla = fecha del documento o del correo; 0.80) y
   `fecha_fin = fecha_inicio + N meses − 1 día` (0.70). Convención verificada contra los
   contratos con fechas explícitas de los fixtures.
5. **Póliza**: "no pide/requiere póliza" en el correo → `false`; cláusula de GARANTÍAS (o el
   correo) que menciona póliza → `true` y se infiere `tipo_poliza` (cumplimiento, calidad,
   responsabilidad_civil, salarios_prestaciones); si nada lo menciona → `false` con confianza 0.80.
6. **País**: palabras clave (Bogotá, Quito, Lima, Tegucigalpa…) o prefijo RUC/NIT → 0.85.
   **Cliente/NIT/objeto**: del encabezado, 0.95. **Comercial**: `comerciales.json` por remitente;
   si no aparece → `advertencias`, no bloquea.
7. **Otrosí**: el documento empieza con `OTROSÍ`. El alcance de validación se reduce a los campos
   que el otrosí trae (no nulos), de modo que `cliente`, `fecha_inicio` o `requiere_poliza` que el
   otrosí no toca **no** disparan revisión.
8. **Confianza**: 0.95 directo · 0.85 inferido con regla segura · 0.80 derivado del correo ·
   0.70 derivado del plazo · 0.60 indeterminado · 0 ausente (`null`, jamás se inventa).
9. **Dónde entra el modelo**: solo en la orquestación y la redacción. Nunca en el valor, las
   fechas ni el maestro. Si el modelo manda un contrato alterado, `contratos_validar` lo detecta
   (compara contra la extracción canónica, que se recalcula desde el disco) y agrega una
   advertencia; `contratos_registrar` exige `confirmado: true` para aceptar la corrección manual.

## 6. Regla de gobierno (documentación obligatoria del PRD 7.5)

1. **Canal único**: `contratos@periferia-ficticia.com`, administrado por Operaciones TI. Solo se
   registran contratos que lleguen allí; cualquier correo a una bandeja personal queda fuera del
   maestro. El agente marca como advertencia a los remitentes que no están en `comerciales.json`.
2. **Obligación del comercial**: enviar **antes de 2 días hábiles** desde la firma el PDF (hoy .txt)
   con las cláusulas OBJETO, VALOR, PLAZO y GARANTÍAS, más los otrosíes y actas de terminación.
   Asunto obligatorio: `Contrato <ID> - <Cliente>` u `Otrosí <N> contrato <ID> - <Cliente>`.
   Un solo contrato por correo.
3. **Acuse automático**: el agente responde en el mismo hilo en menos de 5 minutos con la tabla
   de clasificación (`nuevo` / `actualizacion` / `duplicado` / `rechazado`) y el estado
   (`registrado`, `pendiente de tu confirmación` o `rechazado + motivo`).
4. **Excepciones y escalamiento**: contrato sin firmar o sin valor determinado → queda en
   `requiere_revision` y **no se registra** hasta que el comercial confirme valor y vigencia; si en
   24 horas no hay respuesta, escala al jefe comercial y a Legal. Un correo sin contrato se
   responde como `rechazado` con el motivo, sin tocar el maestro.
5. **Cierre del gap (junio–agosto 2026)**: campaña única: (a) se reconstruyen los contratos de ese
   periodo desde los correos históricos reenviados al buzón único con asunto
   `Contrato <ID> - <Cliente> (retro)`, (b) se corre el agente por lotes con `fecha de hoy` de la
   ejecución, (c) los que queden en revisión se cierran con una sesión de firma con el comercial,
   y (d) se auditan las filas con `fecha_registro` posterior al corte (`out/alertas.md`, sección 3).
6. **Indicador mensual**: `% de contratos facturados del mes que existen en el maestro`
   (meta 100%, alerta < 95%). Complemento operativo: cantidad de correos en el buzón con más de
   2 días sin procesar.

## 7. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | Ciclo de agente propio (~150 líneas) + adaptador propio | Framework de agentes (LangChain, LlamaIndex, Vercel AI) | Las reglas CA1–CA5 (tope, historial, confirmación en código, log) se evalúan y se leen mucho más fácil a mano; un framework añade abstracción opaca y dependencias difíciles de justificar. |
| 2 | Extracción determinista con confianza por campo | Que el modelo extraiga los datos y "confíe" en ellos | RN5/CA2 exigen confianza calculable y valores que no dependan del modelo; además la demo debe correr sin clave y con resultados repetibles. Costo: hay que mantener reglas para cada cláusula nueva. |
| 3 | Gate de confirmación **dentro** de `contratos_registrar` (sesión + `confirmado`) | Confiar en que el prompt no llame con `confirmado: true` | Un modelo puede desobedecer; el gate en código hace la regla innegociable y testeable (la demo lo verifica). |
| 4 | Sesión y maestro en archivos (`out/`, CSV, JSONL) | SQLite / Redis | El PRD no exige base de datos y los archivos hacen la entrega auditable: `maestro-contratos.csv`, `historial.jsonl`, `log.jsonl`. Limitación asumida: un solo proceso escribiendo. |
| 5 | `mock` como proveedor por defecto | Exigir API key para arrancar | Arranque en <2 minutos sin secretos y demo determinista; el real se activa con `.env`. |

## 8. Supuestos al interpretar el PRD

- Los contratos llegan con texto legible (fixtures .txt); en producción habría que añadir
  extracción de PDF y, para escaneos, OCR (hoy `contratos_leer_pdf` solo descomprime streams con
  texto).
- Convención de fechas: cuando el documento no da día de inicio, `fecha_inicio` = día siguiente a
  la fecha de firma/correo y `fecha_fin = fecha_inicio + N meses − 1 día` (coincide con los
  contratos que sí traen ambas fechas).
- "Otrosí" = documento que empieza por `OTROSÍ`; su alcance de validación son solo los campos que
  modifica.
- Remitente desconocido → advertencia, no bloquea el registro.
- Corte `2026-05-30` y ventana de 60 días son literales del PRD.
- El buzón y el maestro de fixtures son de solo lectura (RN6): la copia de trabajo se crea en
  `out/sharepoint/maestro-contratos.csv`.

## 9. Cobertura de historias de usuario

| HU | Estado | Evidencia / qué falta para producción |
|---|---|---|
| HU-1 Leer el buzón | Hecho | `contratos_leer_buzon` + `procesados.json` (no relee lo ya tratado) |
| HU-2 Extraer datos | Hecho | `contratos_extraer` con confianza por campo; falta OCR para PDF escaneados |
| HU-3 Validar y clasificar | Hecho | `contratos_validar`: nuevo / actualizacion / duplicado / rechazado + `requiere_revision` |
| HU-4 Registrar y archivar | Hecho | `contratos_registrar` escribe el CSV, copia el documento, agrega `historial.jsonl` y marca procesado |
| HU-5 Alertar | Hecho | `contratos_alertas` → `out/alertas.md` (vencen ≤60 días, pólizas, post-corte) |
| HU-6 Manejo de errores | Hecho | `{ ok:false, error }` en todas las herramientas, timeout al proveedor, CA5 en el chat |
| Front (historial, tool calls, "pensando", confirmación resaltada) | Hecho | `web/` sin dependencias |
| Sesión persistente + tope de tokens | Hecho | `out/sessions/*.json`, `AGENT_MAX_TOKENS_SESION` |
| Streaming de respuestas | No hecho | Opcional en el PRD; habría que añadir SSE en `/api/chat` |
| Despliegue público | No hecho | Se corre en local/docker en la defensa (penalización aceptada) |
| Autenticación | No hecho | El PRD lo deja como opcional |

## 10. Uso de IA

- **Asistente de código (opencode)**: esqueleto inicial del repositorio (tipos, CSV, fechas,
  extracción y validación), redacción de `agent/prompt.md` y `src/knowledge/`, y la mayor parte de
  las piezas del ciclo y del front. Tareas de depuración (codificación de los fixtures, la
  detección de otrosí y el gate de confirmación) se resolvieron iterando con `npm run typecheck`
  y `npm run demo`.
- **Qué se descartó de lo propuesto**: (a) frameworks de agentes, por opacidad frente a las reglas
  CA1–CA5; (b) que el LLM extrajera los datos "para simplificar", porque rompe RN5 y la demo sin
  clave; (c) una base de datos para la sesión, innecesaria para el alcance.
- Los valores que aparecen en el maestro salen de `src/lib/`, nunca de texto generado.

## 11. Riesgos a producción y mitigación

| Riesgo | Mitigación |
|---|---|
| El modelo ignora el prompt y llama `confirmado: true` sin preguntar | El gate está en `contratos_registrar` + pendiente en sesión: sin pendiente devuelve error |
| Falsos duplicados por variación del nombre del cliente | Dedupe por `id_contrato` y por `nit_cliente` + similitud de objeto (≥ 0.9), no por nombre |
| Contratos escaneados sin texto | `contratos_leer_pdf` ya existe como punto de extensión; agregar OCR (Tesseract/LLM-vision) antes de la extracción |
| Escrituras concurrentes sobre el CSV | Un solo proceso (el servidor); si se escala, mover `out/` a un volumen con bloqueo o pasar a SQLite |
| Costo descontrolado del proveedor | `AGENT_MAX_ITERACIONES` y `AGENT_MAX_TOKENS_SESION` + timeout por petición; la clave solo en el backend |
| Deriva entre la app y el módulo bonus | `npm run sync-modulo` regenera `modulo/` desde la misma fuente |
| Correo con datos sensibles | Fixtures sintéticos; en producción, enmascarar NIT/nombres antes de mandar el texto al proveedor |
