import { cargarCorreo, marcarProcesado } from "./buzon.ts";
import { extraer } from "./extraccion.ts";
import { fechaDeISO, hoyISO, maxFecha } from "./fechas.ts";
import { absoluto, enCola, esRelativaSegura, existe, type Ctx } from "./paths.ts";
import {
  agregarHistorial,
  buscarPorId,
  combinar,
  copiarDocumento,
  guardarMaestro,
  leerMaestro,
} from "./maestro.ts";
import { CAMPOS_DATO, type Contrato } from "./tipos.ts";
import { esOtrosi, validar } from "./validacion.ts";

export type DataRegistro = {
  id_contrato: string;
  accion: "nuevo" | "actualizacion" | "duplicado" | "rechazado";
  ruta_archivo: string | null;
  cambios: number;
  requiere_revision: string[];
  advertencias: string[];
  motivo?: string;
};

export type ResultadoRegistro =
  | { ok: true; data: DataRegistro }
  | { ok: false; error: string };

function normalizarValor(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "boolean") return valor ? "true" : "false";
  return String(valor);
}

export function diferenciasEntre(canonico: Contrato, recibido: Contrato): string[] {
  const campos = [...CAMPOS_DATO, "comercial"];
  const diffs: string[] = [];
  for (const campo of campos) {
    const a = (canonico as unknown as Record<string, unknown>)[campo];
    const b = (recibido as unknown as Record<string, unknown> | undefined)?.[campo];
    if (normalizarValor(a) !== normalizarValor(b)) diffs.push(campo);
  }
  return diffs;
}

function generarAutoId(filas: { id_contrato: string }[], fechaRegistro: string): string {
  const anio = fechaRegistro.slice(0, 4);
  const secuencia =
    filas.filter((f) => f.id_contrato.startsWith(`AUTO-${anio}-`)).length + 1;
  return `AUTO-${anio}-${String(secuencia).padStart(3, "0")}`;
}

function registrarSincrono(
  ctx: Ctx,
  mensajeId: string,
  contratoRecibido: Contrato,
  confirmado: boolean,
  camposPermitidos: string[] = [],
): ResultadoRegistro {
  const correo = cargarCorreo(ctx, mensajeId);
  if (!correo) {
    return { ok: false, error: `no existe el mensaje "${mensajeId}" en el buzón` };
  }
  const canonica = extraer(ctx, mensajeId);
  if (!canonica.ok) return { ok: false, error: canonica.error };

  let contrato = canonica.contrato;
  const diferencias = diferenciasEntre(contrato, contratoRecibido ?? contrato);

  if (diferencias.length > 0 && !confirmado) {
    return {
      ok: false,
      error: `el contrato recibido difiere de la extracción canónica en: ${diferencias.join(", ")}. Vuelve a llamar contratos_extraer y usa el resultado tal cual.`,
    };
  }

  const permitidos = new Set(camposPermitidos);
  const aceptados: string[] = [];
  const descartados: string[] = [];
  if (diferencias.length > 0) {
    const recibido = (contratoRecibido ?? {}) as unknown as Record<string, unknown>;
    const base = contrato as unknown as Record<string, unknown>;
    for (const campo of CAMPOS_DATO) {
      if (permitidos.has(campo) && campo in recibido) {
        base[campo] = recibido[campo];
        aceptados.push(campo);
      }
    }
    for (const campo of diferencias) {
      if (!permitidos.has(campo)) descartados.push(campo);
    }
  }

  const validacion = validar(ctx, contrato);
  const advertencias = [...validacion.advertencias];
  if (aceptados.length > 0) {
    advertencias.push(`corrección confirmada en: ${aceptados.join(", ")}`);
  }
  if (descartados.length > 0) {
    advertencias.push(`se ignoró el cambio del contrato recibido en: ${descartados.join(", ")}`);
  }

  if (validacion.clasificacion === "rechazado") {
    marcarProcesado(ctx, mensajeId);
    return {
      ok: true,
      data: {
        id_contrato: contrato.id_contrato ?? "",
        accion: "rechazado",
        ruta_archivo: null,
        cambios: 0,
        requiere_revision: [],
        advertencias,
        motivo: validacion.motivo ?? "sin contrato identificable",
      },
    };
  }

  if (validacion.clasificacion === "duplicado") {
    marcarProcesado(ctx, mensajeId);
    const filas = leerMaestro(ctx);
    const existente = buscarPorId(filas, validacion.id_contrato_existente ?? contrato.id_contrato ?? "");
    return {
      ok: true,
      data: {
        id_contrato: existente?.id_contrato ?? contrato.id_contrato ?? "",
        accion: "duplicado",
        ruta_archivo: existente?.ruta_sharepoint ?? null,
        cambios: 0,
        requiere_revision: [],
        advertencias,
        motivo: "ya registrado con el mismo valor y vigencias; no se escribe nada",
      },
    };
  }

  if (validacion.requiere_revision.length > 0 && !confirmado) {
    const detalle = validacion.requiere_revision
      .map((campo) => `${campo} (confianza ${(contrato.confianza[campo] ?? 0).toFixed(2)})`)
      .join(", ");
    return {
      ok: false,
      error: `requiere revisión: ${detalle}. Muestra el detalle a la usuaria, pídele confirmación y repite la llamada con confirmado: true.`,
    };
  }

  const fechaCorreo = fechaDeISO(correo.fecha) ?? "";
  const fechaRegistro = maxFecha(ctx.hoy ?? hoyISO(), fechaCorreo);
  const filas = leerMaestro(ctx);
  const idBase = validacion.id_contrato_existente ?? null;
  const base = idBase ? buscarPorId(filas, idBase) ?? null : null;

  if (esOtrosi(contrato) && !base) {
    return {
      ok: false,
      error: `otrosí sin fila base en el maestro para "${contrato.id_contrato ?? "id desconocido"}"`,
    };
  }

  let objetivo = contrato;
  if (!objetivo.id_contrato) {
    objetivo = { ...objetivo, id_contrato: generarAutoId(filas, fechaRegistro) };
  }

  const { fila, cambios } = combinar(base, objetivo, { fechaRegistro });
  const meta = (objetivo.meta ?? {}) as Record<string, unknown>;
  const extension = typeof meta.extension === "string" && meta.extension ? meta.extension : "txt";
  const rutaDocumento = base
    ? base.ruta_sharepoint.replace(/\.([A-Za-z0-9]+)$/i, `_${mensajeId}.${extension}`)
    : fila.ruta_sharepoint;

  const rutaAdjunto = String(meta.ruta_adjunto ?? "");
  if (!esRelativaSegura(rutaAdjunto)) {
    return { ok: false, error: "la ruta del documento de origen no es válida" };
  }
  const origen = absoluto(ctx, rutaAdjunto);
  if (!existe(origen)) {
    return { ok: false, error: `no se encontró el documento de origen (${rutaAdjunto || "sin ruta"})` };
  }
  copiarDocumento(ctx, origen, rutaDocumento);

  const indice = filas.findIndex((f) => f.id_contrato === fila.id_contrato);
  if (indice >= 0) filas[indice] = fila;
  else filas.push(fila);
  guardarMaestro(ctx, filas);

  agregarHistorial(ctx, {
    ts: new Date().toISOString(),
    id_contrato: fila.id_contrato,
    accion: base ? "actualizacion" : "nuevo",
    cambios,
    mensaje_id: mensajeId,
    ruta_documento: rutaDocumento,
  });
  marcarProcesado(ctx, mensajeId);

  return {
    ok: true,
    data: {
      id_contrato: fila.id_contrato,
      accion: base ? "actualizacion" : "nuevo",
      ruta_archivo: rutaDocumento,
      cambios: cambios.length,
      requiere_revision: validacion.requiere_revision,
      advertencias,
    },
  };
}

export function registrar(
  ctx: Ctx,
  mensajeId: string,
  contratoRecibido: Contrato,
  confirmado: boolean,
  camposPermitidos: string[] = [],
): Promise<ResultadoRegistro> {
  return enCola(() => registrarSincrono(ctx, mensajeId, contratoRecibido, confirmado, camposPermitidos));
}
