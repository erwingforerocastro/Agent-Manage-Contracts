import fs from "node:fs";
import path from "node:path";
import { aCsv, aBool, aNumero, parseCsv, type Fila } from "./csv.ts";
import { anadirLinea, absoluto, existe, leerTexto, escribirTexto, rutaPosix } from "./paths.ts";
import { slug, similitud } from "./texto.ts";
import { COLUMNAS_MAESTRO, type Cambio, type Contrato, type EntradaHistorial, type FilaMaestro } from "./tipos.ts";

export function rutaMaestroSalida(ctx: { directory: string }): string {
  return absoluto(ctx as never, "out/sharepoint/maestro-contratos.csv");
}

function aFilaMaestro(f: Fila): FilaMaestro {
  return {
    id_contrato: f.id_contrato ?? "",
    cliente: f.cliente ?? "",
    nit_cliente: f.nit_cliente ?? "",
    pais: f.pais ?? "",
    objeto: f.objeto ?? "",
    valor: aNumero(f.valor ?? "0"),
    moneda: f.moneda ?? "",
    fecha_inicio: f.fecha_inicio ?? "",
    fecha_fin: f.fecha_fin ?? "",
    requiere_poliza: aBool(f.requiere_poliza ?? "false"),
    tipo_poliza: f.tipo_poliza ?? "",
    estado_poliza: f.estado_poliza ?? "",
    comercial: f.comercial ?? "",
    ruta_sharepoint: f.ruta_sharepoint ?? "",
    fecha_registro: f.fecha_registro ?? "",
    fuente: f.fuente ?? "",
  };
}

export function inicializarSharepoint(ctx: { directory: string }): void {
  const destino = rutaMaestroSalida(ctx);
  if (existe(destino)) return;
  const origen = absoluto(ctx as never, "fixtures/reto-02/maestro-contratos.csv");
  const { columnas, filas } = parseCsv(leerTexto(origen));
  const orden = columnas.length > 0 ? columnas : [...COLUMNAS_MAESTRO];
  const texto = aCsv(
    orden,
    filas.map((f) => ({ ...aFilaMaestro(f) }) as unknown as Fila),
  );
  escribirTexto(destino, texto);
}

export function leerMaestro(ctx: { directory: string }): FilaMaestro[] {
  inicializarSharepoint(ctx);
  const { filas } = parseCsv(leerTexto(rutaMaestroSalida(ctx)));
  return filas.map((f) => aFilaMaestro(f));
}

export function guardarMaestro(ctx: { directory: string }, filas: FilaMaestro[]): void {
  const texto = aCsv(
    [...COLUMNAS_MAESTRO],
    filas.map((f) => ({ ...f }) as unknown as Fila),
  );
  escribirTexto(rutaMaestroSalida(ctx), texto);
}

export function buscarPorId(filas: FilaMaestro[], id: string): FilaMaestro | undefined {
  return filas.find((f) => f.id_contrato === id);
}

export function buscarPorNitObjeto(
  filas: FilaMaestro[],
  nit: string | null,
  objeto: string | null,
): { fila: FilaMaestro; similitud: number } | null {
  if (!nit || !objeto) return null;
  let mejor: { fila: FilaMaestro; similitud: number } | null = null;
  for (const fila of filas) {
    if (fila.nit_cliente !== nit) continue;
    const s = similitud(fila.objeto, objeto);
    if (!mejor || s > mejor.similitud) mejor = { fila, similitud: s };
  }
  return mejor && mejor.similitud >= 0.9 ? mejor : null;
}

export function construirRutaSharepoint(fila: FilaMaestro, extension: string): string {
  const anio = (fila.fecha_inicio || "2026").slice(0, 4);
  const cliente = slug(fila.cliente) || "sin-cliente";
  return rutaPosix("Contratos", anio, cliente, `${fila.id_contrato}.${extension}`);
}

function filaVacia(fechaRegistro: string, fuente: string): FilaMaestro {
  return {
    id_contrato: "",
    cliente: "",
    nit_cliente: "",
    pais: "",
    objeto: "",
    valor: 0,
    moneda: "",
    fecha_inicio: "",
    fecha_fin: "",
    requiere_poliza: false,
    tipo_poliza: "",
    estado_poliza: "",
    comercial: "",
    ruta_sharepoint: "",
    fecha_registro: fechaRegistro,
    fuente,
  };
}

export function combinar(
  base: FilaMaestro | null,
  contrato: Contrato,
  opciones: { fechaRegistro: string; fuente?: string },
): { fila: FilaMaestro; cambios: Cambio[] } {
  const destino: FilaMaestro = base
    ? { ...base }
    : filaVacia(opciones.fechaRegistro, opciones.fuente ?? "buzon");
  const cambios: Cambio[] = [];

  const asignar = (campo: keyof FilaMaestro, valor: unknown): void => {
    if (valor === null || valor === undefined) return;
    const actual = destino[campo];
    const textoActual = typeof actual === "boolean" ? String(actual) : String(actual);
    const textoNuevo = typeof valor === "boolean" ? String(valor) : String(valor);
    if (textoActual === textoNuevo) return;
    if (base) cambios.push({ campo, anterior: textoActual, nuevo: textoNuevo });
    (destino as unknown as Record<string, unknown>)[campo] = valor;
  };

  asignar("id_contrato", contrato.id_contrato);
  asignar("cliente", contrato.cliente);
  asignar("nit_cliente", contrato.nit_cliente);
  asignar("pais", contrato.pais);
  asignar("objeto", contrato.objeto);
  asignar("valor", contrato.valor);
  asignar("moneda", contrato.moneda);
  asignar("fecha_inicio", contrato.fecha_inicio);
  asignar("fecha_fin", contrato.fecha_fin);
  asignar("requiere_poliza", contrato.requiere_poliza);
  asignar("tipo_poliza", contrato.tipo_poliza);
  asignar("comercial", contrato.comercial);

  if (contrato.requiere_poliza === false) {
    asignar("estado_poliza", "no_aplica");
  } else if (contrato.requiere_poliza === true && destino.estado_poliza !== "vigente") {
    asignar("estado_poliza", contrato.estado_poliza ?? "pendiente");
  }

  if (!base) {
    const meta = (contrato.meta ?? {}) as Record<string, unknown>;
    const extension = typeof meta.extension === "string" && meta.extension ? meta.extension : "txt";
    destino.ruta_sharepoint = construirRutaSharepoint(destino, extension);
  }

  return { fila: destino, cambios };
}

export function absolutizarSharepoint(ctx: { directory: string }, relativa: string): string {
  return absoluto(ctx as never, `out/sharepoint/${relativa}`);
}

export function copiarDocumento(
  ctx: { directory: string },
  origenAbs: string,
  relativaDestino: string,
): string {
  const destino = absolutizarSharepoint(ctx, relativaDestino);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origenAbs, destino);
  return destino;
}

export function agregarHistorial(ctx: { directory: string }, entrada: EntradaHistorial): void {
  anadirLinea(
    absoluto(ctx as never, "out/sharepoint/historial.jsonl"),
    JSON.stringify(entrada),
  );
}

export function leerHistorial(ctx: { directory: string }): EntradaHistorial[] {
  const ruta = absoluto(ctx as never, "out/sharepoint/historial.jsonl");
  if (!existe(ruta)) return [];
  return leerTexto(ruta)
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as EntradaHistorial);
}
