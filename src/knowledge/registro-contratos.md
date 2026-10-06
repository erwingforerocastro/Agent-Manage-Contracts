# Conocimiento de negocio: Registro de Contratos Vigentes

## Datos y rutas

- Buzón: `fixtures/reto-02/buzon/<msg-id>/` con `correo.json` y adjuntos (`.txt` o `.pdf`).
- Maestro: `fixtures/reto-02/maestro-contratos.csv` (solo lectura). La copia de trabajo que se escribe es `out/sharepoint/maestro-contratos.csv`.
- Comerciales: `fixtures/reto-02/comerciales.json`.
- Documentos archivados: `out/sharepoint/Contratos/<año_inicio>/<slug>/<id_contrato>.<ext>`.
- Estado: `out/procesados.json` (ids de mensajes ya tratados), `out/sessions/<sesion>.json`, `out/log.jsonl` (RN7), `out/alertas.md`, `out/historial.jsonl`.
- Columnas del maestro: `id_contrato, cliente, nit_cliente, pais, objeto, valor, moneda, fecha_inicio, fecha_fin, requiere_poliza, tipo_poliza, estado_poliza, comercial, ruta_sharepoint, fecha_registro, fuente`.

## Campos de dato (los únicos que se validan)

`id_contrato, cliente, nit_cliente, pais, objeto, valor, moneda, fecha_inicio, fecha_fin, requiere_poliza, tipo_poliza, estado_poliza` (12 en total).

`comercial`, `ruta_sharepoint`, `fecha_registro` y `fuente` son administrativos: se rellenan solos; si el remitente no está en `comerciales.json` se avisa en `advertencias`, no en `requiere_revision`.

## Clasificación

- `rechazado`: el correo no contiene un contrato (p. ej. cotizaciones, presupuestos).
- `duplicado`: ya existe una fila con el mismo `id_contrato` **y** los datos coinciden; no se escribe nada.
- `actualizacion`: existe la fila y algún campo de dato cambió; se actualiza y se agrega entrada a `historial.jsonl`.
- `nuevo`: no existe la fila; se crea con id del documento o `AUTO-<año>-<seq>`.

## Confianza por campo (matriz)

| Confianza | Origen |
|---|---|
| 0.95 | valor literal en la cláusula del documento |
| 0.85 | inferido con regla segura (país por palabras clave, moneda por "pesos") |
| 0.80 | fecha_inicio derivada del correo; ausencia de cláusula de póliza |
| 0.70 | fecha_fin derivada del plazo |
| 0.60 | valor indeterminado ("sin monto", "a futuro") |
| 0 | campo ausente → `null`, confianza 0 |

## `requiere_revision`

- Cualquier campo en alcance con confianza `< 0.80`.
- Además, cuando la clasificación es `actualizacion`: campos que difieren del maestro y tienen confianza `< 0.90`.
- Para un otrosí, el alcance son solo los campos que cambiaron (no nulos).
- `tipo_poliza` queda fuera de alcance cuando `requiere_poliza === false`.

## Convención de fechas

- `fecha_fin = fecha_inicio + N meses − 1 día`.
- `fecha_inicio` no declarada → se deriva del correo/firma (confianza 0.80) y su fin se recalcula con el plazo.
- `fecha_registro = max(fecha de hoy, fecha del correo)`.

## Alertas (`contratos_alertas`)

- Fecha de corte del maestro: `2026-05-30`. Ventana: 60 días.
- Sección 1: contratos con `fecha_fin` dentro de los 60 días desde `hoy` (más nota de los ya vencidos).
- Sección 2: `requiere_poliza === true` y `estado !== vigente`.
- Sección 3: `fecha_registro > 2026-05-30`.

## Flujo de confirmación (CA3)

`contratos_registrar` con `confirmado: true` solo es válido si hay un pendiente en la sesión para ese `mensaje_id`; si no, devuelve error. El pendiente se fija al fallar la primera llamada y se limpia al registrar con éxito.
