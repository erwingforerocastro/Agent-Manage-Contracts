import { existe, leerTexto, escribirTexto, asegurarDir, absoluto, enCola, type Ctx } from "../lib/paths.ts";
import path from "node:path";
import type { Llamada } from "../llm/adapter.ts";

export type Pendiente = {
  mensaje_id: string;
  campos: string[];
  ts: string;
};

export type RegistroLlamada = {
  ts: string;
  id: string;
  nombre: string;
  args: unknown;
  resultado: string;
  ok: boolean;
  iteracion: number;
};

export type EntradaChat =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: Llamada[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type Sesion = {
  id: string;
  creada: string;
  actualizada: string;
  mensajes: EntradaChat[];
  pendientes: Record<string, Pendiente>;
  llamadas: RegistroLlamada[];
  tokens: { prompt: number; completion: number };
  turnos: number;
};

function idSeguro(id: string): string {
  const limpio = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return limpio === "" ? "default" : limpio;
}

export function rutaSesion(ctx: Ctx, id: string): string {
  return absoluto(ctx, `out/sessions/${idSeguro(id)}.json`);
}

function crear(id: string): Sesion {
  const ahora = new Date().toISOString();
  return {
    id: idSeguro(id),
    creada: ahora,
    actualizada: ahora,
    mensajes: [],
    pendientes: {},
    llamadas: [],
    tokens: { prompt: 0, completion: 0 },
    turnos: 0,
  };
}

export function cargarSesion(ctx: Ctx, id: string): Sesion {
  const ruta = rutaSesion(ctx, id);
  if (!existe(ruta)) return crear(id);
  try {
    const datos = JSON.parse(leerTexto(ruta)) as Partial<Sesion>;
    const pendienteLegado = "pendiente" in datos
      ? (datos as unknown as { pendiente?: Pendiente }).pendiente
      : undefined;
    return {
      ...crear(id),
      ...datos,
      mensajes: Array.isArray(datos.mensajes) ? datos.mensajes : [],
      llamadas: Array.isArray(datos.llamadas) ? datos.llamadas : [],
      pendientes:
        datos.pendientes && typeof datos.pendientes === "object"
          ? datos.pendientes
          : pendienteLegado
            ? { [pendienteLegado.mensaje_id]: pendienteLegado }
            : {},
    };
  } catch {
    return crear(id);
  }
}

export function guardarSesion(ctx: Ctx, sesion: Sesion): void {
  sesion.actualizada = new Date().toISOString();
  const ruta = rutaSesion(ctx, sesion.id);
  asegurarDir(path.dirname(ruta));
  escribirTexto(ruta, JSON.stringify(sesion, null, 2));
}

export function agregarEntrada(ctx: Ctx, id: string, entrada: EntradaChat): Promise<Sesion> {
  return enCola(async () => {
    const sesion = cargarSesion(ctx, id);
    sesion.mensajes.push(entrada);
    guardarSesion(ctx, sesion);
    return sesion;
  });
}

export function leerPendientes(ctx: Ctx): Pendiente[] {
  return Object.values(cargarSesion(ctx, ctx.sessionId).pendientes);
}

export function fijarPendiente(ctx: Ctx, pendiente: { mensaje_id: string; campos: string[] }): Promise<void> {
  return enCola(async () => {
    const sesion = cargarSesion(ctx, ctx.sessionId);
    sesion.pendientes[pendiente.mensaje_id] = { ...pendiente, ts: new Date().toISOString() };
    guardarSesion(ctx, sesion);
  });
}

export function limpiarPendiente(ctx: Ctx, mensajeId?: string): Promise<void> {
  return enCola(async () => {
    const sesion = cargarSesion(ctx, ctx.sessionId);
    if (mensajeId) delete sesion.pendientes[mensajeId];
    else sesion.pendientes = {};
    guardarSesion(ctx, sesion);
  });
}

export function registrarLlamada(ctx: Ctx, id: string, registro: Omit<RegistroLlamada, "ts">): Promise<void> {
  return enCola(async () => {
    const sesion = cargarSesion(ctx, id);
    sesion.llamadas.push({ ts: new Date().toISOString(), ...registro });
    guardarSesion(ctx, sesion);
  });
}

export function sumarTokens(ctx: Ctx, id: string, prompt: number, completion: number): Promise<Sesion> {
  return enCola(async () => {
    const sesion = cargarSesion(ctx, id);
    sesion.tokens.prompt += prompt;
    sesion.tokens.completion += completion;
    guardarSesion(ctx, sesion);
    return sesion;
  });
}
