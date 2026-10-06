import fs from "node:fs";
import { existe, leerTexto, escribirTexto, absoluto } from "./paths.ts";
import type { Correo } from "./tipos.ts";

export type MensajeBuzon = {
  id: string;
  de: string;
  para: string;
  asunto: string;
  fecha: string;
  adjuntos: string[];
  tiene_contrato: boolean;
};

export function rutaProcesados(ctx: { directory: string }): string {
  return absoluto(ctx as never, "out/procesados.json");
}

export function leerProcesados(ctx: { directory: string }): string[] {
  const ruta = rutaProcesados(ctx);
  if (!existe(ruta)) return [];
  try {
    const datos = JSON.parse(leerTexto(ruta)) as unknown;
    return Array.isArray(datos) ? datos.map((d) => String(d)) : [];
  } catch {
    return [];
  }
}

export function marcarProcesado(ctx: { directory: string }, mensajeId: string): void {
  const actuales = leerProcesados(ctx);
  if (actuales.includes(mensajeId)) return;
  escribirTexto(rutaProcesados(ctx), JSON.stringify([...actuales, mensajeId], null, 2));
}

function dirBuzon(ctx: { directory: string }): string {
  return absoluto(ctx as never, "fixtures/reto-02/buzon");
}

export function cargarCorreo(ctx: { directory: string }, mensajeId: string): Correo | null {
  if (!/^msg-\d+$/i.test(mensajeId)) return null;
  const ruta = `${dirBuzon(ctx)}/${mensajeId}/correo.json`;
  if (!existe(ruta)) return null;
  try {
    return JSON.parse(leerTexto(ruta)) as Correo;
  } catch {
    return null;
  }
}

export function tieneAdjuntoDeContrato(adjuntos: string[]): boolean {
  return adjuntos.some((a) => /^(contrato|otros)/i.test(a));
}

export function leerBuzon(ctx: { directory: string }): MensajeBuzon[] {
  const procesados = leerProcesadosSet(ctx);
  const base = dirBuzon(ctx);
  if (!existe(base)) return [];
  const ids = fsReaddir(base).filter((n) => /^msg-\d+$/i.test(n));
  const mensajes: MensajeBuzon[] = [];
  for (const id of ids.sort()) {
    if (procesados.has(id)) continue;
    const correo = cargarCorreo(ctx, id);
    if (!correo) continue;
    mensajes.push({
      id: correo.id,
      de: correo.de,
      para: correo.para,
      asunto: correo.asunto,
      fecha: correo.fecha,
      adjuntos: correo.adjuntos ?? [],
      tiene_contrato: tieneAdjuntoDeContrato(correo.adjuntos ?? []),
    });
  }
  return mensajes.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function leerAdjunto(
  ctx: { directory: string },
  mensajeId: string,
  nombre: string,
): string | null {
  const ruta = `${dirBuzon(ctx)}/${mensajeId}/${nombre}`;
  if (!existe(ruta)) return null;
  return leerTexto(ruta);
}

function leerProcesadosSet(ctx: { directory: string }): Set<string> {
  return new Set(leerProcesados(ctx));
}

function fsReaddir(ruta: string): string[] {
  try {
    return fs.readdirSync(ruta);
  } catch {
    return [];
  }
}
