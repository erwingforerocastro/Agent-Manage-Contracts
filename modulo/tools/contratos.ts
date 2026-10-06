import { z } from "zod";
import { leerBuzon, cargarCorreo } from "../lib/buzon.ts";
import { extraer as extraerContrato } from "../lib/extraccion.ts";
import { generarAlertas } from "../lib/alertas.ts";
import { registrarLog } from "../lib/log.ts";
import { esFechaValida } from "../lib/fechas.ts";
import { absoluto, esRelativaSegura, existe, type Ctx } from "../lib/paths.ts";
import { registrar as ejecutarRegistro, diferenciasEntre } from "../lib/registro.ts";
import { contratoZod, type Contrato } from "../lib/tipos.ts";
import { validar as validarContrato } from "../lib/validacion.ts";
import { fijarPendiente, limpiarPendiente, leerPendientes } from "../agent/session.ts";
import fs from "node:fs";
import zlib from "node:zlib";

function ok(data: unknown): string {
  return JSON.stringify({ ok: true, data });
}

function fallo(error: string): string {
  return JSON.stringify({ ok: false, error });
}

const argMensajeId = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, "solo letras, números, guiones y guion bajo")
  .describe('id del mensaje en el buzón, por ejemplo "msg-001"');

const argHoy = z
  .string()
  .describe("fecha de referencia del reporte en formato YYYY-MM-DD");

const argConfirmado = z
  .boolean()
  .optional()
  .describe("true únicamente después de que la usuaria confirme los campos en revisión");

export const leer_buzon = {
  description:
    "Lista los mensajes del buzón de contratos aún no procesados, con remitente, asunto, fecha, adjuntos y si contienen un contrato.",
  args: {},
  async execute(_args: Record<string, never>, ctx: Ctx): Promise<string> {
    try {
      const mensajes = leerBuzon(ctx);
      const resumen = { mensajes, pendientes: mensajes.length };
      registrarLog(ctx, {
        herramienta: "contratos_leer_buzon",
        ok: true,
        resumen: `${mensajes.length} mensaje(s) sin procesar`,
      });
      return ok(resumen);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      registrarLog(ctx, { herramienta: "contratos_leer_buzon", ok: false, resumen: error });
      return fallo(error);
    }
  },
};

export const extraer = {
  description:
    "Extrae los datos estructurados del contrato adjunto de un mensaje, con confianza [0,1] por campo; campos ausentes quedan en null.",
  args: { mensaje_id: argMensajeId },
  async execute(args: { mensaje_id: string }, ctx: Ctx): Promise<string> {
    try {
      const correo = cargarCorreo(ctx, args.mensaje_id);
      if (!correo) {
        const error = `no existe el mensaje "${args.mensaje_id}" en el buzón`;
        registrarLog(ctx, {
          herramienta: "contratos_extraer",
          mensaje_id: args.mensaje_id,
          ok: false,
          resumen: error,
        });
        return fallo(error);
      }
      const resultado = extraerContrato(ctx, args.mensaje_id);
      if (!resultado.ok) {
        registrarLog(ctx, {
          herramienta: "contratos_extraer",
          mensaje_id: args.mensaje_id,
          ok: false,
          resumen: resultado.error,
        });
        return fallo(resultado.error);
      }
      registrarLog(ctx, {
        herramienta: "contratos_extraer",
        mensaje_id: args.mensaje_id,
        ok: true,
          resumen: `id=${resultado.contrato.id_contrato ?? "-"} campos=${
            Array.isArray(resultado.contrato.meta.campos_extraidos)
              ? resultado.contrato.meta.campos_extraidos.length
              : 0
          }`,
      });
      return ok(resultado.contrato);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      registrarLog(ctx, {
        herramienta: "contratos_extraer",
        mensaje_id: args.mensaje_id,
        ok: false,
        resumen: error,
      });
      return fallo(error);
    }
  },
};

export const validar = {
  description:
    "Clasifica un contrato extraído como nuevo, actualización, duplicado o rechazado y devuelve los campos que requieren revisión humana.",
  args: {
    mensaje_id: argMensajeId,
    contrato: contratoZod.describe("contrato devuelto por contratos_extraer, sin modificar"),
  },
  async execute(args: { mensaje_id: string; contrato: Contrato }, ctx: Ctx): Promise<string> {
    try {
      const canonica = extraerContrato(ctx, args.mensaje_id);
      if (!canonica.ok) {
        registrarLog(ctx, {
          herramienta: "contratos_validar",
          mensaje_id: args.mensaje_id,
          ok: false,
          resumen: canonica.error,
        });
        return fallo(canonica.error);
      }
      const difiere = diferenciasEntre(canonica.contrato, args.contrato);
      const resultado = validarContrato(ctx, canonica.contrato);
      if (difiere.length > 0) {
        resultado.advertencias.push(
          `el contrato enviado difiere de la extracción canónica en: ${difiere.join(", ")}; se validó la extracción canónica`,
        );
      }
      registrarLog(ctx, {
        herramienta: "contratos_validar",
        mensaje_id: args.mensaje_id,
        ok: true,
        resumen: `${resultado.clasificacion} revision=[${resultado.requiere_revision.join("|")}]`,
      });
      return ok(resultado);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      registrarLog(ctx, {
        herramienta: "contratos_validar",
        mensaje_id: args.mensaje_id,
        ok: false,
        resumen: error,
      });
      return fallo(error);
    }
  },
};

export const registrar = {
  description:
    "Escribe o actualiza la fila en el maestro, archiva el documento en out/sharepoint y marca el mensaje como procesado; si hay campos en revisión exige confirmado: true.",
  args: {
    mensaje_id: argMensajeId,
    contrato: contratoZod.describe("contrato devuelto por contratos_extraer, sin modificar"),
    confirmado: argConfirmado,
  },
  async execute(
    args: { mensaje_id: string; contrato: Contrato; confirmado?: boolean },
    ctx: Ctx,
  ): Promise<string> {
    try {
      const confirmado = args.confirmado === true;
      const pendiente = leerPendientes(ctx).find((p) => p.mensaje_id === args.mensaje_id) ?? null;
      if (confirmado && !pendiente) {
        const error = `no hay campos pendientes de confirmación para "${args.mensaje_id}"; primero ejecuta contratos_validar y muestra el detalle a la usuaria.`;
        registrarLog(ctx, {
          herramienta: "contratos_registrar",
          mensaje_id: args.mensaje_id,
          ok: false,
          resumen: error,
        });
        return fallo(error);
      }
      const camposPermitidos = pendiente ? pendiente.campos : [];
      const resultado = await ejecutarRegistro(ctx, args.mensaje_id, args.contrato, confirmado, camposPermitidos);
      if (resultado.ok) {
        await limpiarPendiente(ctx, args.mensaje_id);
      } else {
        const canonica = extraerContrato(ctx, args.mensaje_id);
        if (canonica.ok) {
          const revision = validarContrato(ctx, canonica.contrato).requiere_revision;
          if (revision.length > 0) {
            await fijarPendiente(ctx, { mensaje_id: args.mensaje_id, campos: revision });
          }
        }
      }
      registrarLog(ctx, {
        herramienta: "contratos_registrar",
        mensaje_id: args.mensaje_id,
        ok: resultado.ok,
        resumen: resultado.ok
          ? `${resultado.data.accion} id=${resultado.data.id_contrato} ruta=${resultado.data.ruta_archivo ?? "-"}`
          : resultado.error,
      });
      return resultado.ok ? ok(resultado.data) : fallo(resultado.error);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      registrarLog(ctx, {
        herramienta: "contratos_registrar",
        mensaje_id: args.mensaje_id,
        ok: false,
        resumen: error,
      });
      return fallo(error);
    }
  },
};

export const alertas = {
  description:
    "Genera out/alertas.md con los contratos que vencen en 60 días o menos, las pólizas sin estado vigente y los contratos registrados después del corte.",
  args: { hoy: argHoy },
  async execute(args: { hoy: string }, ctx: Ctx): Promise<string> {
    try {
      if (!esFechaValida(args.hoy)) {
        const error = `fecha inválida: "${args.hoy}". Usa el formato YYYY-MM-DD.`;
        registrarLog(ctx, {
          herramienta: "contratos_alertas",
          ok: false,
          resumen: error,
        });
        return fallo(error);
      }
      const datos = generarAlertas(ctx, args.hoy);
      registrarLog(ctx, {
        herramienta: "contratos_alertas",
        ok: true,
        resumen: `vencen=${datos.vencen.length} vencidos=${datos.vencidos.length} polizas=${datos.polizas_pendientes.length} nuevos=${datos.registrados_desde_corte.length}`,
      });
      return ok(datos);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      registrarLog(ctx, { herramienta: "contratos_alertas", ok: false, resumen: error });
      return fallo(error);
    }
  },
};

export const leer_pdf = {
  description: "Devuelve el texto de un archivo del proyecto (PDF nativo o .txt) en ruta relativa al repositorio.",
  args: {
    ruta: z.string().describe("ruta relativa al proyecto, por ejemplo fixtures/reto-02/buzon/msg-001/contrato.txt"),
  },
  async execute(args: { ruta: string }, ctx: Ctx): Promise<string> {
    try {
      const rel = args.ruta.replace(/\\/g, "/");
      if (!esRelativaSegura(rel)) {
        const error = "la ruta debe ser relativa y no puede contener ..";
        registrarLog(ctx, { herramienta: "contratos_leer_pdf", ok: false, resumen: error });
        return fallo(error);
      }
      const abs = absoluto(ctx, rel);
      if (!existe(abs)) {
        const error = `no existe el archivo ${rel}`;
        registrarLog(ctx, { herramienta: "contratos_leer_pdf", ok: false, resumen: error });
        return fallo(error);
      }
      const buffer = fs.readFileSync(abs);
      const texto = rel.toLowerCase().endsWith(".pdf") ? textoDePdf(buffer) : buffer.toString("utf8");
      if (texto.trim() === "") {
        const error = `el archivo ${rel} no contiene texto extraíble`;
        registrarLog(ctx, { herramienta: "contratos_leer_pdf", ok: false, resumen: error });
        return fallo(error);
      }
      registrarLog(ctx, {
        herramienta: "contratos_leer_pdf",
        ok: true,
        resumen: `${rel}: ${texto.length} caracteres`,
      });
      return ok({ ruta: rel, texto });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      registrarLog(ctx, { herramienta: "contratos_leer_pdf", ok: false, resumen: error });
      return fallo(error);
    }
  },
};

function textoDePdf(buffer: Buffer): string {
  const latin = buffer.toString("latin1");
  const partes: string[] = [];
  const reStream = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const coincidencia of latin.matchAll(reStream)) {
    const crudo = coincidencia[1] ?? "";
    let contenido = crudo;
    try {
      contenido = zlib.inflateSync(Buffer.from(crudo, "latin1")).toString("latin1");
    } catch {
      // el stream no está comprimido (FlateDecode ausente)
    }
    if (!/\b(?:Tj|TJ|BT)\b/.test(contenido)) continue;
    const reTexto = /\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f]+)>/g;
    for (const t of contenido.matchAll(reTexto)) {
      if (t[1] !== undefined) partes.push(desescapar(t[1]));
      else if (t[2] !== undefined) partes.push(hexATexto(t[2]));
    }
    partes.push("\n");
  }
  return partes.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function desescapar(texto: string): string {
  return texto
    .replace(/\\([nrtbf()\\])/g, (_m, c: string) => {
      const mapa: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
      return mapa[c] ?? c;
    })
    .replace(/\\(\d{1,3})/g, (_m, o: string) => String.fromCharCode(parseInt(o, 8)));
}

function hexATexto(hex: string): string {
  const limpio = hex.length % 2 === 0 ? hex : `${hex}0`;
  const bytes: number[] = [];
  for (let i = 0; i < limpio.length; i += 2) bytes.push(parseInt(limpio.slice(i, i + 2), 16));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let salida = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      salida += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
    }
    return salida;
  }
  return bytes.map((b) => String.fromCharCode(b)).join("");
}
