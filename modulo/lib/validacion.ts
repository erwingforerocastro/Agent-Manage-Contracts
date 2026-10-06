import type { Ctx } from "./paths.ts";
import { buscarPorId, buscarPorNitObjeto, leerMaestro } from "./maestro.ts";
import { CAMPOS_DATO, type Contrato, type FilaMaestro, type ResultadoValidacion } from "./tipos.ts";

function metaDe(contrato: Contrato): Record<string, unknown> {
  return contrato.meta ?? {};
}

export function esOtrosi(contrato: Contrato): boolean {
  return metaDe(contrato).es_otrosi === true;
}

export function camposEnAlcance(contrato: Contrato): string[] {
  const otrosi = esOtrosi(contrato);
  return CAMPOS_DATO.filter((campo) => {
    const valor = (contrato as unknown as Record<string, unknown>)[campo];
    if (otrosi) return valor !== null && valor !== undefined;
    if (campo === "tipo_poliza" && contrato.requiere_poliza === false) return false;
    return true;
  });
}

function confianzaDe(contrato: Contrato, campo: string): number {
  return contrato.confianza[campo] ?? 0;
}

function mismosValoresBasicos(fila: FilaMaestro, contrato: Contrato): boolean {
  return (
    Number(fila.valor) === Number(contrato.valor ?? NaN) &&
    fila.fecha_inicio === (contrato.fecha_inicio ?? "") &&
    fila.fecha_fin === (contrato.fecha_fin ?? "")
  );
}

export function validar(ctx: Ctx, contrato: Contrato): ResultadoValidacion {
  const advertencias = [...(contrato.advertencias ?? [])];

  if (!contrato.es_contrato) {
    return {
      clasificacion: "rechazado",
      requiere_revision: [],
      diferencias: [],
      advertencias,
      motivo: contrato.motivo_rechazo ?? "no se identificó un contrato en el adjunto",
    };
  }

  const lista = leerMaestro(ctx);
  const id = contrato.id_contrato;

  let existente: FilaMaestro | undefined = id ? buscarPorId(lista, id) : undefined;
  let clasificacion: ResultadoValidacion["clasificacion"];

  if (existente && !esOtrosi(contrato)) {
    clasificacion = mismosValoresBasicos(existente, contrato) ? "duplicado" : "actualizacion";
  } else if (existente) {
    clasificacion = "actualizacion";
  } else {
    const porNit = buscarPorNitObjeto(lista, contrato.nit_cliente, contrato.objeto);
    if (porNit) {
      existente = porNit.fila;
      clasificacion = "actualizacion";
      advertencias.push(
        `sin coincidencia por id; la fila ${porNit.fila.id_contrato} coincide por nit_cliente + objeto (similitud ${porNit.similitud.toFixed(2)})`,
      );
    } else {
      clasificacion = "nuevo";
    }
  }

  if (esOtrosi(contrato) && !existente) {
    return {
      clasificacion: "rechazado",
      requiere_revision: [],
      diferencias: [],
      advertencias,
      motivo: `otrosí de ${id ?? "un contrato"} sin fila correspondiente en el maestro`,
    };
  }

  const enAlcance = camposEnAlcance(contrato);
  const revision = new Set<string>();
  for (const campo of enAlcance) {
    if (confianzaDe(contrato, campo) < 0.8) revision.add(campo);
  }

  const diferencias =
    clasificacion === "actualizacion" && existente
      ? diferenciasDe(existente, contrato)
      : [];

  if (clasificacion === "actualizacion") {
    for (const cambio of diferencias) {
      if (!enAlcance.includes(cambio.campo)) continue;
      if (confianzaDe(contrato, cambio.campo) < 0.9) revision.add(cambio.campo);
    }
  }

  const requiere_revision = CAMPOS_DATO.filter((campo) => revision.has(campo));

  const resultado: ResultadoValidacion = {
    clasificacion,
    requiere_revision,
    diferencias,
    advertencias,
  };
  if (existente) resultado.id_contrato_existente = existente.id_contrato;
  return resultado;
}

export function diferenciasDe(fila: FilaMaestro, contrato: Contrato): { campo: string; anterior: string; nuevo: string }[] {
  const cambios: { campo: string; anterior: string; nuevo: string }[] = [];
  for (const campo of CAMPOS_DATO) {
    const valor = (contrato as unknown as Record<string, unknown>)[campo];
    if (valor === null || valor === undefined) continue;
    if (campo === "tipo_poliza" && contrato.requiere_poliza === false) continue;
    const actual = (fila as unknown as Record<string, unknown>)[campo];
    const textoActual = typeof actual === "boolean" ? String(actual) : String(actual ?? "");
    const textoNuevo = typeof valor === "boolean" ? String(valor) : String(valor);
    if (textoActual !== textoNuevo) {
      cambios.push({ campo, anterior: textoActual, nuevo: textoNuevo });
    }
  }
  return cambios;
}
