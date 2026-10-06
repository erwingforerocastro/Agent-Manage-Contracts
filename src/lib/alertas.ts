import { escribirTexto, absoluto, type Ctx } from "./paths.ts";
import { leerMaestro } from "./maestro.ts";
import { diasEntre } from "./fechas.ts";
import type { FilaMaestro } from "./tipos.ts";

export const CORTE_MAESTRO = "2026-05-30";
export const VENTANA_DIAS = 60;

export type ItemAlerta = {
  id_contrato: string;
  cliente: string;
  fecha_fin: string;
  dias_restantes: number;
};

export type ItemPoliza = {
  id_contrato: string;
  cliente: string;
  estado_poliza: string;
  tipo_poliza: string;
  fecha_fin: string;
};

export type ItemRegistro = {
  id_contrato: string;
  cliente: string;
  fecha_registro: string;
  fuente: string;
};

export type DatosAlertas = {
  hoy: string;
  ruta: string;
  vencen: ItemAlerta[];
  vencidos: ItemAlerta[];
  polizas_pendientes: ItemPoliza[];
  registrados_desde_corte: ItemRegistro[];
};

function aItem(fila: FilaMaestro, hoy: string): ItemAlerta {
  return {
    id_contrato: fila.id_contrato,
    cliente: fila.cliente,
    fecha_fin: fila.fecha_fin,
    dias_restantes: diasEntre(hoy, fila.fecha_fin),
  };
}

function porId(a: { id_contrato: string }, b: { id_contrato: string }): number {
  return a.id_contrato.localeCompare(b.id_contrato);
}

export function calcularAlertas(ctx: Ctx, hoy: string): DatosAlertas {
  const filas = leerMaestro(ctx);
  const vencen: ItemAlerta[] = [];
  const vencidos: ItemAlerta[] = [];

  for (const fila of filas) {
    if (!fila.fecha_fin) continue;
    const dias = diasEntre(hoy, fila.fecha_fin);
    if (dias < 0) vencidos.push(aItem(fila, hoy));
    else if (dias <= VENTANA_DIAS) vencen.push(aItem(fila, hoy));
  }
  vencen.sort((a, b) => a.dias_restantes - b.dias_restantes);
  vencidos.sort((a, b) => a.dias_restantes - b.dias_restantes);

  const polizas_pendientes: ItemPoliza[] = filas
    .filter((f) => f.requiere_poliza && f.estado_poliza !== "vigente")
    .map((f) => ({
      id_contrato: f.id_contrato,
      cliente: f.cliente,
      estado_poliza: f.estado_poliza,
      tipo_poliza: f.tipo_poliza,
      fecha_fin: f.fecha_fin,
    }))
    .sort(porId);

  const registrados_desde_corte: ItemRegistro[] = filas
    .filter((f) => f.fecha_registro > CORTE_MAESTRO)
    .map((f) => ({
      id_contrato: f.id_contrato,
      cliente: f.cliente,
      fecha_registro: f.fecha_registro,
      fuente: f.fuente,
    }))
    .sort(porId);

  return {
    hoy,
    ruta: "out/alertas.md",
    vencen,
    vencidos,
    polizas_pendientes,
    registrados_desde_corte,
  };
}

function tabla(encabezados: string[], filas: string[][]): string {
  const cabeza = `| ${encabezados.join(" | ")} |`;
  const separador = `| ${encabezados.map(() => "---").join(" | ")} |`;
  const cuerpo = filas.map((f) => `| ${f.join(" | ")} |`);
  return [cabeza, separador, ...cuerpo].join("\n");
}

export function redactarAlertas(datos: DatosAlertas): string {
  const lineas: string[] = [];
  lineas.push(`# Alertas de contratos vigentes`);
  lineas.push("");
  lineas.push(`- Fecha de referencia: **${datos.hoy}**`);
  lineas.push(`- Ventana de vencimiento: ${VENTANA_DIAS} días`);
  lineas.push(`- Corte del maestro: ${CORTE_MAESTRO}`);
  lineas.push("");
  lineas.push(`## 1. Contratos que vencen en ${VENTANA_DIAS} días o menos`);
  lineas.push("");
  if (datos.vencen.length === 0) {
    lineas.push("_Ningún contrato vence dentro de la ventana._");
  } else {
    lineas.push(
      tabla(
        ["id_contrato", "cliente", "fecha_fin", "días restantes"],
        datos.vencen.map((v) => [v.id_contrato, v.cliente, v.fecha_fin, String(v.dias_restantes)]),
      ),
    );
  }
  lineas.push("");
  lineas.push("**Ya vencidos (acción inmediata):**");
  lineas.push("");
  if (datos.vencidos.length === 0) {
    lineas.push("_Sin contratos vencidos._");
  } else {
    lineas.push(
      tabla(
        ["id_contrato", "cliente", "fecha_fin", "días vencido"],
        datos.vencidos.map((v) => [v.id_contrato, v.cliente, v.fecha_fin, String(Math.abs(v.dias_restantes))]),
      ),
    );
  }
  lineas.push("");
  lineas.push("## 2. Pólizas exigidas sin estado vigente");
  lineas.push("");
  if (datos.polizas_pendientes.length === 0) {
    lineas.push("_Sin pólizas pendientes._");
  } else {
    lineas.push(
      tabla(
        ["id_contrato", "cliente", "tipo_poliza", "estado", "fecha_fin"],
        datos.polizas_pendientes.map((p) => [
          p.id_contrato,
          p.cliente,
          p.tipo_poliza || "-",
          p.estado_poliza,
          p.fecha_fin,
        ]),
      ),
    );
  }
  lineas.push("");
  lineas.push(`## 3. Contratos registrados después del corte (${CORTE_MAESTRO})`);
  lineas.push("");
  if (datos.registrados_desde_corte.length === 0) {
    lineas.push("_Sin registros nuevos: el gap sigue abierto._");
  } else {
    lineas.push(
      tabla(
        ["id_contrato", "cliente", "fecha_registro", "fuente"],
        datos.registrados_desde_corte.map((r) => [
          r.id_contrato,
          r.cliente,
          r.fecha_registro,
          r.fuente,
        ]),
      ),
    );
  }
  lineas.push("");
  return lineas.join("\n");
}

export function generarAlertas(ctx: Ctx, hoy: string): DatosAlertas {
  const datos = calcularAlertas(ctx, hoy);
  escribirTexto(absoluto(ctx, "out/alertas.md"), redactarAlertas(datos));
  return datos;
}
