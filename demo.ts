import { existe, leerTexto, limpiarDirectorio, absoluto, type Ctx } from "./src/lib/paths.ts";
import { ejecutarTurno, type Deps } from "./src/agent/cycle.ts";
import { construirRegistro } from "./src/agent/registry.ts";
import { cargarPromptSistema } from "./src/agent/prompt.ts";
import { crearMock } from "./src/llm/mock.ts";
import { leerHistorial, leerMaestro } from "./src/lib/maestro.ts";
import { leerProcesados } from "./src/lib/buzon.ts";
import { calcularAlertas } from "./src/lib/alertas.ts";
import type { FilaMaestro } from "./src/lib/tipos.ts";

const RAIZ = process.cwd();
const HOY = "2026-09-03";
const ctx: Ctx = { directory: RAIZ, sessionId: "demo", hoy: HOY };

type Comprobacion = { nombre: string; ok: boolean; detalle: string };
const comprobaciones: Comprobacion[] = [];

function verificar(nombre: string, ok: boolean, detalle = ""): void {
  comprobaciones.push({ nombre, ok, detalle });
  const marca = ok ? "  ok " : "FALLA";
  const extra = ok || detalle === "" ? "" : `  → ${detalle}`;
  console.log(`[${marca}] ${nombre}${extra}`);
}

function igual(nombre: string, esperado: unknown, obtenido: unknown): void {
  const a = JSON.stringify(esperado);
  const b = JSON.stringify(obtenido);
  verificar(nombre, a === b, `esperado ${a}, obtenido ${b}`);
}

function imprimirReporte(titulo: string, llamadas: { nombre: string; args: unknown; resultado: string; ok: boolean }[]): void {
  console.log(`\n${titulo}`);
  const filas: string[] = [];
  const ids = new Set<string>();
  const args = (l: { args: unknown }): Record<string, unknown> =>
    (l.args ?? {}) as Record<string, unknown>;
  for (const l of llamadas) {
    const id = args(l).mensaje_id;
    if (typeof id === "string") ids.add(id);
  }
  for (const id of [...ids].sort()) {
    const extraer = llamadas.find((l) => l.nombre === "contratos_extraer" && args(l).mensaje_id === id);
    const validar = llamadas.find((l) => l.nombre === "contratos_validar" && args(l).mensaje_id === id);
    const registrar = llamadas
      .filter((l) => l.nombre === "contratos_registrar" && args(l).mensaje_id === id)
      .pop();
    const datos = (l?: { resultado: string }): Record<string, unknown> => {
      if (!l) return {};
      try {
        const parseado = JSON.parse(l.resultado) as { data?: Record<string, unknown> };
        return parseado.data ?? {};
      } catch {
        return {};
      }
    };
    const extraccion = datos(extraer);
    const validacion = datos(validar);
    const registro = datos(registrar);
    const revision = (validacion.requiere_revision as string[] | undefined) ?? [];
    const idContrato = String(extraccion.id_contrato ?? registro.id_contrato ?? "").trim();
    let accion = "sin llamar";
    if (registrar) {
      if (!registrar.ok) accion = "pendiente de confirmación";
      else if (registro.accion === "rechazado") accion = "rechazado (sin escritura)";
      else accion = `${String(registro.accion)} → ${String(registro.id_contrato)}`;
    }
    filas.push(
      `| ${id} | ${idContrato === "" ? "—" : idContrato} | ${String(validacion.clasificacion ?? "—")} | ${accion} | ${
        revision.length > 0 ? revision.join(", ") : "—"
      } |`,
    );
  }
  console.log("| Mensaje | Contrato | Clasificación | Acción | Revisión |");
  console.log("|---|---|---|---|---|");
  for (const fila of filas) console.log(fila);
}

function filaPorId(filas: FilaMaestro[], id: string): FilaMaestro | undefined {
  return filas.find((f) => f.id_contrato === id);
}

const deps: Deps = {
  adaptador: crearMock(),
  promptSistema: cargarPromptSistema(),
  maxIteraciones: 25,
  maxTokensSesion: 200000,
  registro: construirRegistro(),
};

limpiarDirectorio(absoluto(ctx, "out"));

console.log("=== Reto 02 · demostración determinista (hoy = 2026-09-03) ===\n");
console.log("--- Turno 1: procesar el buzón ---");

const turno1 = await ejecutarTurno(
  deps,
  ctx,
  "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, " +
    "muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. " +
    "No registres nada dudoso sin preguntarme.",
);

console.log(`\n(turno 1: ${turno1.iteraciones} iteraciones, ${turno1.toolCalls.length} llamadas a herramientas)`);
imprimirReporte("\n--- Reporte por mensaje (primera pasada) ---", turno1.toolCalls);
console.log("");

const filas1 = leerMaestro(ctx);
const procesados1 = leerProcesados(ctx);
const ct015 = filaPorId(filas1, "CT-2026-015");
const ct016 = filaPorId(filas1, "CT-2026-016");
const ct011 = filaPorId(filas1, "CT-2026-011");

verificar("turno 1 respeta el tope de 25 iteraciones", turno1.iteraciones <= 25, String(turno1.iteraciones));
verificar("turno 1 hace llamadas a herramientas", turno1.toolCalls.length > 0);
igual("turno 1 pide confirmación (msg-006 pendiente)", true, turno1.needsConfirmation);
igual("maestro tras turno 1: 10 filas (8 + 2 nuevas)", 10, filas1.length);
igual(
  "msg-001 → nuevo CT-2026-015 registrado",
  ["nuevo", 265000000, "COP", "2026-08-01", "2027-07-31", true, "pendiente"],
  ct015
    ? [
        "nuevo",
        ct015.valor,
        ct015.moneda,
        ct015.fecha_inicio,
        ct015.fecha_fin,
        ct015.requiere_poliza,
        ct015.estado_poliza,
      ]
    : null,
);
igual(
  "msg-002 → nuevo CT-2026-016 sin póliza",
  ["2026-08-15", "2027-08-14", false, "no_aplica", 120000, "USD"],
  ct016
    ? [
        ct016.fecha_inicio,
        ct016.fecha_fin,
        ct016.requiere_poliza,
        ct016.estado_poliza,
        ct016.valor,
        ct016.moneda,
      ]
    : null,
);
igual(
  "msg-003 → actualización CT-2026-011 (valor y fecha_fin)",
  [520000, "PEN", "2027-11-01"],
  ct011 ? [ct011.valor, ct011.moneda, ct011.fecha_fin] : null,
);
igual("msg-004 → duplicado: CT-2026-012 sin cambios", 1, filas1.filter((f) => f.id_contrato === "CT-2026-012").length);
igual("msg-005 → rechazado: no aparece COT-2026-088", undefined, filaPorId(filas1, "COT-2026-088"));
igual(
  "msg-006 → NO registrado hasta confirmar (sin CM-2026-03)",
  undefined,
  filaPorId(filas1, "CM-2026-03"),
);
igual("mensajes procesados en turno 1", ["msg-001", "msg-002", "msg-003", "msg-004", "msg-005"], [...procesados1].sort());

const historial1 = leerHistorial(ctx);
const entrada011 = historial1.find((h) => h.id_contrato === "CT-2026-011");
verificar("historial registra la actualización de CT-2026-011", entrada011?.accion === "actualizacion");
igual("historial de CT-2026-011 tiene 2 cambios", 2, entrada011?.cambios.length);

const doc015 = ct015 ? absoluto(ctx, `out/sharepoint/${ct015.ruta_sharepoint}`) : "";
verificar("documento de CT-2026-015 copiado a out/sharepoint", existe(doc015), doc015);
const doc011 = absoluto(ctx, "out/sharepoint/Contratos/2026/minera-los-andes/CT-2026-011_msg-003.txt");
verificar("otrosí archivado como CT-2026-011_msg-003", existe(doc011), doc011);

const alertas1 = existe(absoluto(ctx, "out/alertas.md"));
verificar("out/alertas.md generado en turno 1", alertas1);
const textoRespuesta1 = turno1.reply.toLowerCase();
verificar("respuesta menciona msg-006", textoRespuesta1.includes("msg-006"));
verificar("respuesta menciona valor y fecha_fin en revisión", textoRespuesta1.includes("valor") && textoRespuesta1.includes("fecha_fin"));
verificar("respuesta termina con alertas", textoRespuesta1.includes("alertas"));

const log1 = existe(absoluto(ctx, "out/log.jsonl"))
  ? leerTexto(absoluto(ctx, "out/log.jsonl")).trim().split("\n").filter((l) => l !== "")
  : [];
verificar("RN7: out/log.jsonl registra las ejecuciones", log1.length >= 10, `${log1.length} líneas`);

console.log("\n--- Turno 2: confirmación de msg-006 ---\n");

const turno2 = await ejecutarTurno(deps, ctx, "Confirmo el registro de msg-006.");
console.log(`\n(turno 2: ${turno2.iteraciones} iteraciones, ${turno2.toolCalls.length} llamadas a herramientas)`);
imprimirReporte("\n--- Reporte por mensaje (tras confirmación) ---", turno2.toolCalls);
console.log("");

const filas2 = leerMaestro(ctx);
const procesados2 = leerProcesados(ctx);
const cm03 = filaPorId(filas2, "CM-2026-03");

verificar("turno 2 respeta el tope de 25 iteraciones", turno2.iteraciones <= 25, String(turno2.iteraciones));
verificar(
  "turno 2 vuelve a generar las alertas después de confirmar",
  turno2.toolCalls.some((t) => t.nombre === "contratos_alertas"),
  turno2.toolCalls.map((t) => t.nombre).join(", "),
);
igual("la respuesta final cita el contrato confirmado", true, turno2.reply.includes("CM-2026-03"));
igual("maestro final: 11 filas", 11, filas2.length);
igual(
  "msg-006 confirmado → CM-2026-03 con valor indeterminado (0) y fechas derivadas",
  [0, "2026-09-01", "2027-08-31"],
  cm03 ? [cm03.valor, cm03.fecha_inicio, cm03.fecha_fin] : null,
);
igual("6 mensajes procesados al final", 6, procesados2.length);
igual("msg-006 ya no queda pendiente", false, turno2.needsConfirmation);

const docCm = cm03 ? absoluto(ctx, `out/sharepoint/${cm03.ruta_sharepoint}`) : "";
verificar("documento de CM-2026-03 copiado a out/sharepoint", existe(docCm), docCm);

const datos = calcularAlertas(ctx, HOY);
igual(
  "alertas: contratos en la ventana de 60 días",
  ["CT-2026-004", "CT-2026-009"],
  datos.vencen.map((v) => v.id_contrato).sort(),
);
igual("alertas: contratos ya vencidos", ["CT-2025-018", "CT-2026-002"], datos.vencidos.map((v) => v.id_contrato).sort());
for (const esperado of ["CT-2026-004", "CT-2026-015"]) {
  verificar(
    `alertas: póliza exigida pendiente incluye ${esperado}`,
    datos.polizas_pendientes.some((p) => p.id_contrato === esperado),
    datos.polizas_pendientes.map((p) => p.id_contrato).join(", "),
  );
}
igual(
  "alertas: 3 contratos registrados después del corte 2026-05-30",
  3,
  datos.registrados_desde_corte.length,
);

const textoAlertas = existe(absoluto(ctx, "out/alertas.md")) ? leerTexto(absoluto(ctx, "out/alertas.md")) : "";
verificar("out/alertas.md contiene las secciones 1, 2 y 3", /## 1\./.test(textoAlertas) && /## 2\./.test(textoAlertas) && /## 3\./.test(textoAlertas));

const maestroFinal = leerTexto(absoluto(ctx, "out/sharepoint/maestro-contratos.csv"));
verificar("maestro final contiene CM-2026-03", maestroFinal.includes("CM-2026-03"));
verificar("el mensaje rechazado no ensució el maestro", !maestroFinal.includes("COT-2026-088"));

console.log("\n=== Resumen del mensaje final del agente ===\n");
console.log(turno2.reply);

const fallas = comprobaciones.filter((c) => !c.ok);
console.log(
  `\n=== ${comprobaciones.length - fallas.length}/${comprobaciones.length} comprobaciones correctas ===`,
);
if (fallas.length > 0) {
  console.log("\nFallaron:");
  for (const f of fallas) console.log(` - ${f.nombre}${f.detalle ? ` (${f.detalle})` : ""}`);
  process.exitCode = 1;
}
