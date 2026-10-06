import path from "node:path";
import { cargarCorreo, leerAdjunto } from "./buzon.ts";
import { absoluto, existe, leerTexto, type Ctx } from "./paths.ts";
import { addMonths, anioMes, fechaDeISO, menosUnDia, parseFecha, sumaDias } from "./fechas.ts";
import { limpiarIdentificador, parseNumero, recortar, titulo } from "./texto.ts";
import { MONEDAS, type Contrato, type Correo } from "./tipos.ts";

export const CONF = {
  directo: 0.95,
  inferido: 0.85,
  derivadoCorreo: 0.8,
  derivadoPlazo: 0.7,
  indeterminado: 0.6,
  ausente: 0,
} as const;

export type Extraccion = { ok: true; contrato: Contrato } | { ok: false; error: string };

type Valores = Omit<Contrato, "confianza" | "advertencias" | "meta">;

const ORDINAL =
  /^(PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|S[ÉE]PTIMA|OCTAVA|NOVENA|DECIMA)\./i;

const PAIS_POR_PALABRA: [RegExp, string][] = [
  [/\bbogot[áa]|\bmedell[íi]n|\bbarranquilla|\bcartagena|\bcolombia\b/i, "CO"],
  [/\bquito|\bguayaquil|\becuador\b/i, "EC"],
  [/\blima\b|\barequipa|\bper[úu]\b/i, "PE"],
  [/\bpanam[áa]\b/i, "PA"],
  [/\btegucigalpa|\bsan pedro sula|\bhonduras\b/i, "HN"],
];

const TIPOS_POLIZA: [RegExp, string][] = [
  [/cumplimiento/i, "cumplimiento"],
  [/\bcalidad\b/i, "calidad"],
  [/responsabilidad\s+civil/i, "responsabilidad_civil"],
  [/salarios|prestaciones/i, "salarios_prestaciones"],
];

function vacio(correo: Correo, adjunto: string | null, motivo: string): Contrato {
  const confianza: Record<string, number> = {};
  const campos = [
    "id_contrato",
    "cliente",
    "nit_cliente",
    "pais",
    "objeto",
    "valor",
    "moneda",
    "fecha_inicio",
    "fecha_fin",
    "requiere_poliza",
    "tipo_poliza",
    "estado_poliza",
    "comercial",
  ];
  for (const campo of campos) confianza[campo] = CONF.ausente;
  return {
    es_contrato: false,
    motivo_rechazo: motivo,
    id_contrato: null,
    cliente: null,
    nit_cliente: null,
    pais: null,
    objeto: null,
    valor: null,
    moneda: null,
    fecha_inicio: null,
    fecha_fin: null,
    requiere_poliza: null,
    tipo_poliza: null,
    estado_poliza: null,
    comercial: null,
    confianza,
    advertencias: [],
    meta: {
      es_otrosi: false,
      valor_indeterminado: false,
      plazo_meses: null,
      fecha_documento: null,
      fecha_correo: fechaDeISO(correo.fecha) ?? "",
      nombre_adjunto: adjunto,
      campos_extraidos: [],
    },
  };
}

function dividirClausulas(texto: string): string[] {
  const lineas = texto.replace(/\r\n/g, "\n").split("\n");
  const segmentos: string[] = [];
  let actual = "";
  for (const linea of lineas) {
    if (ORDINAL.test(linea.trim())) {
      if (actual.trim() !== "") segmentos.push(actual.trim());
      actual = linea;
    } else {
      actual += `${actual === "" ? "" : "\n"}${linea}`;
    }
  }
  if (actual.trim() !== "") segmentos.push(actual.trim());
  return segmentos;
}

function encabezado(segmento: string): string {
  return segmento.slice(0, 60);
}

function clausulasDe(segmentos: string[], tipo: "OBJETO" | "VALOR" | "PLAZO"): string[] {
  return segmentos.filter((s) => {
    const cabeza = encabezado(s).toUpperCase();
    if (tipo === "OBJETO") return new RegExp(`^[A-ZÁÉÍÓÚÑ]+\\.\\s*OBJETO\\.`).test(cabeza);
    if (tipo === "VALOR") {
      return (
        new RegExp(`^[A-ZÁÉÍÓÚÑ]+\\.\\s*VALOR\\.`).test(cabeza) ||
        new RegExp(`\\(${tipo}\\)`).test(encabezado(s).toUpperCase())
      );
    }
    return (
      new RegExp(`^[A-ZÁÉÍÓÚÑ]+\\.\\s*PLAZO\\.`).test(cabeza) ||
      new RegExp(`\\(${tipo}\\)`).test(encabezado(s).toUpperCase())
    );
  });
}

function leerComerciales(ctx: Ctx): { email: string; nombre: string }[] {
  const ruta = absoluto(ctx, "fixtures/reto-02/comerciales.json");
  if (!existe(ruta)) return [];
  try {
    const datos = JSON.parse(leerTexto(ruta)) as { email: string; nombre: string }[];
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  }
}

function fechaFirma(texto: string): { fecha: string | null; mesAnio: { anio: number; mes: number } | null } {
  const indice = texto.search(/\bse\s+firma|\bfirma\s+en\b/i);
  const fragmento = indice >= 0 ? texto.slice(indice, indice + 220) : "";
  return { fecha: parseFecha(fragmento), mesAnio: anioMes(fragmento) };
}

function monedaPorTexto(texto: string): string | null {
  if (/\bCOP\b|pesos/i.test(texto)) return "COP";
  if (/\bUSD\b|d[óo]lares/i.test(texto)) return "USD";
  if (/\bPEN\b|soles/i.test(texto)) return "PEN";
  if (/\bPAB\b|balboas/i.test(texto)) return "PAB";
  if (/\bHNL\b|lempiras/i.test(texto)) return "HNL";
  return null;
}

export function extraer(ctx: Ctx, mensajeId: string): Extraccion {
  const correo = cargarCorreo(ctx, mensajeId);
  if (!correo) {
    return { ok: false, error: `no existe el mensaje "${mensajeId}" en el buzón` };
  }
  const adjunto = (correo.adjuntos ?? [])[0] ?? null;
  if (!adjunto) {
    return {
      ok: true,
      contrato: vacio(correo, null, "el mensaje no tiene adjuntos"),
    };
  }
  const texto = leerAdjunto(ctx, mensajeId, adjunto);
  if (texto === null) {
    return { ok: false, error: `no se pudo leer el adjunto "${adjunto}" del mensaje ${mensajeId}` };
  }
  if (texto.trim() === "") {
    return { ok: false, error: `el adjunto "${adjunto}" del mensaje ${mensajeId} está vacío` };
  }
  return { ok: true, contrato: extraerDeTexto(ctx, correo, adjunto, texto) };
}

function extraerDeTexto(ctx: Ctx, correo: Correo, adjunto: string, texto: string): Contrato {
  const confianza: Record<string, number> = {};
  const advertencias: string[] = [];
  const declarar = (campo: string, valor: unknown, conf: number): void => {
    confianza[campo] = valor === null || valor === undefined ? CONF.ausente : conf;
  };

  const segmentos = dividirClausulas(texto);
  const hayPartes =
    /\bENTRE\s+LOS\s+SUSCRITOS\b/i.test(texto) ||
    (/\bEL\s+CONTRATANTE\b/i.test(texto) && /\bEL\s+CONTRATISTA\b/i.test(texto));
  const encabezadosRelevantes = segmentos
    .slice(1)
    .filter((s) => /(OBJETO|VALOR|PLAZO)/.test(encabezado(s).toUpperCase())).length;
  const esContrato = hayPartes && encabezadosRelevantes >= 2;

  if (!esContrato) {
    const nombre = adjunto;
    const motivo = `el adjunto "${nombre}" no contiene un contrato identificable: no se encontraron partes ni cláusulas numeradas (OBJETO/VALOR/PLAZO)`;
    const rechazado = vacio(correo, adjunto, motivo);
    return rechazado;
  }

  const esOtrosi = /^OTROS[IÍ]/i.test(texto.trim().slice(0, 12));
  const { fecha: fechaDocumento, mesAnio: mesAnioFirma } = fechaFirma(texto);
  const fechaCorreo = fechaDeISO(correo.fecha) ?? "";

  const segmentoObjeto = clausulasDe(segmentos, "OBJETO")[0] ?? null;
  const segmentoValor = clausulasDe(segmentos, "VALOR")[0] ?? null;
  const segmentoPlazo = clausulasDe(segmentos, "PLAZO")[0] ?? null;

  const segmentoGarantias = segmentos.find((s) =>
    /GARANT[ÍI]AS/i.test(encabezado(s).toUpperCase()),
  );

  // id_contrato
  let idContrato: string | null = null;
  const mId = texto.slice(0, 240).match(/\bNo\.\s*([A-Z]{1,5}-\d{4}-\d{1,4})\b/i);
  if (mId) idContrato = (mId[1] ?? "").toUpperCase();

  // valor
  let valor: number | null = null;
  let moneda: string | null = null;
  let indeterminado = false;
  if (segmentoValor) {
    const mImporte = segmentoValor.match(
      /\((COP|USD|PEN|PAB|HNL)\s*\$?\s*([\d.,]+)\)/i,
    );
    if (mImporte) {
      const codigo = (mImporte[1] ?? "").toUpperCase();
      const numero = parseNumero(mImporte[2] ?? "");
      if (!MONEDAS.includes(codigo as (typeof MONEDAS)[number])) {
        return vacio(correo, adjunto, `moneda desconocida en el documento: ${codigo}`);
      }
      if (numero !== null) {
        valor = numero;
        moneda = codigo;
      }
    } else if (/no\s+tiene\s+un\s+valor\s+determinado|valor\s+indeterminado|sin\s+valor\s+determinado/i.test(segmentoValor)) {
      indeterminado = true;
      valor = 0;
      moneda = monedaPorTexto(texto);
    }
  }

  // fechas
  let fechaInicio: string | null = null;
  let fechaFin: string | null = null;
  let plazoMeses: number | null = null;
  let confFechaInicio: number = CONF.directo;
  let confFechaFin: number = CONF.directo;
  if (segmentoPlazo) {
    const mDesde = /\bdesde\s+(.{0,70}?)\s+hasta\b/i.exec(segmentoPlazo);
    const mHasta = /\bhasta\s+(.{0,70})/i.exec(segmentoPlazo);
    if (mDesde) {
      fechaInicio = parseFecha(mDesde[1] ?? "");
      confFechaInicio = fechaInicio ? CONF.directo : CONF.ausente;
    }
    if (mHasta) {
      fechaFin = parseFecha(mHasta[1] ?? "");
      confFechaFin = fechaFin ? CONF.directo : CONF.ausente;
    }
    const mMeses = /\((\d+)\)\s*meses/i.exec(segmentoPlazo) ?? /(\d+)\s*meses/i.exec(segmentoPlazo);
    if (mMeses) plazoMeses = Number(mMeses[1]);

    if (!fechaInicio && !fechaFin && plazoMeses) {
      const ancla = fechaDocumento ?? fechaCorreo;
      if (ancla) {
        fechaInicio = sumaDias(ancla, 1);
        confFechaInicio = CONF.derivadoCorreo;
        fechaFin = menosUnDia(addMonths(fechaInicio, plazoMeses));
        confFechaFin = CONF.derivadoPlazo;
        advertencias.push(
          `la fecha de firma no indica día; fecha_inicio se derivó de ${fechaDocumento ? "la fecha del documento" : "la fecha del correo"} (${ancla}) y fecha_fin = inicio + ${plazoMeses} meses - 1 día`,
        );
      }
    }
  }

  // póliza
  let requierePoliza: boolean | null = null;
  let confRequierePoliza: number = CONF.ausente;
  let tipoPoliza: string | null = null;
  const cuerpoCorreo = correo.cuerpo ?? "";
  const textoPoliza = `${segmentoGarantias ?? ""}\n${cuerpoCorreo}`;
  if (!esOtrosi) {
    if (/no\s+(?:pide|requiere|exige|solicita)\s+(?:una\s+)?p[óo]liza/i.test(cuerpoCorreo)) {
      requierePoliza = false;
      confRequierePoliza = CONF.directo;
    } else if (segmentoGarantias && /p[óo]liza/i.test(segmentoGarantias)) {
      requierePoliza = true;
      confRequierePoliza = CONF.directo;
    } else if (/\bp[óo]liza/i.test(cuerpoCorreo)) {
      requierePoliza = true;
      confRequierePoliza = CONF.directo;
    } else {
      requierePoliza = false;
      confRequierePoliza = CONF.derivadoCorreo;
    }
    if (requierePoliza) {
      const tipos = TIPOS_POLIZA.filter(([re]) => re.test(textoPoliza)).map(([, v]) => v);
      tipoPoliza = tipos.length > 0 ? tipos.join(";") : "cumplimiento";
    }
  }

  // cliente / nit / país / objeto (solo contrato completo)
  let cliente: string | null = null;
  let nit: string | null = null;
  let pais: string | null = null;
  let objeto: string | null = null;
  const primeraParte = texto.slice(
    0,
    texto.indexOf("PERIFERIA IT GROUP") > 0 ? texto.indexOf("PERIFERIA IT GROUP") : texto.length,
  );

  if (!esOtrosi) {
    const mCliente =
      /\bEntre\s+(?:los\s+suscritos\s*,\s*)?(.+?),\s*(?:identificada\s+con|con\s+(?:NIT|RUC|RTN)|(?:NIT|RUC|RTN)\s*[\d.])/i.exec(
        texto,
      );
    if (mCliente && mCliente[1]) cliente = titulo(mCliente[1]);

    const mNit = /(?:NIT|RUC|RTN)\s*([\d.]+(?:-\d+)?)/i.exec(primeraParte);
    if (mNit && mNit[1]) nit = limpiarIdentificador(mNit[1]);

    for (const [re, valorPais] of PAIS_POR_PALABRA) {
      if (re.test(primeraParte)) {
        pais = valorPais;
        break;
      }
    }
    if (!pais) {
      if (/\bRUC\s*[\d.]{13}/.test(primeraParte)) pais = "EC";
      else if (/\bRUC\s*[\d.]{11}/.test(primeraParte)) pais = "PE";
      else if (/\bNIT\b/.test(primeraParte)) pais = "CO";
    }

    if (segmentoObjeto) {
      const marca = segmentoObjeto.search(/OBJETO\./i);
      let cuerpo = marca >= 0 ? segmentoObjeto.slice(marca + "OBJETO.".length) : segmentoObjeto;
      cuerpo = cuerpo.replace(
        /^\s*EL\s+(?:CONTRATANTE|CONTRATISTA)\s+(?:se\s+obliga\s+a\s+|prestar[áa]\s+)?/i,
        "",
      );
      objeto = recortar(cuerpo, 200);
    }
  }

  // comercial
  let comercial: string | null = null;
  let confComercial: number = CONF.ausente;
  const comerciales = leerComerciales(ctx);
  const encontrado = comerciales.find(
    (c) => c.email.toLowerCase() === (correo.de ?? "").toLowerCase(),
  );
  if (encontrado) {
    comercial = encontrado.nombre;
    confComercial = CONF.directo;
  } else {
    advertencias.push(`remitente no registrado en comerciales.json: ${correo.de}`);
  }

  const estadoPoliza: Contrato["estado_poliza"] =
    requierePoliza === null
      ? null
      : requierePoliza
        ? "pendiente"
        : "no_aplica";

  const valores: Valores = {
    es_contrato: true,
    motivo_rechazo: null,
    id_contrato: idContrato,
    cliente,
    nit_cliente: nit,
    pais: pais as Contrato["pais"],
    objeto,
    valor,
    moneda: moneda as Contrato["moneda"],
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    requiere_poliza: requierePoliza,
    tipo_poliza: tipoPoliza,
    estado_poliza: estadoPoliza,
    comercial,
  };

  declarar("id_contrato", idContrato, idContrato ? CONF.directo : CONF.ausente);
  declarar("cliente", cliente, cliente ? CONF.directo : CONF.ausente);
  declarar("nit_cliente", nit, nit ? CONF.directo : CONF.ausente);
  declarar("pais", pais, pais ? CONF.inferido : CONF.ausente);
  declarar("objeto", objeto, objeto ? CONF.directo : CONF.ausente);
  declarar(
    "valor",
    valor,
    valor === null ? CONF.ausente : indeterminado ? CONF.indeterminado : CONF.directo,
  );
  declarar("moneda", moneda, moneda ? (indeterminado ? CONF.inferido : CONF.directo) : CONF.ausente);
  declarar("fecha_inicio", fechaInicio, confFechaInicio);
  declarar("fecha_fin", fechaFin, confFechaFin);
  declarar("requiere_poliza", requierePoliza, confRequierePoliza);
  declarar("tipo_poliza", tipoPoliza, tipoPoliza ? confRequierePoliza : CONF.ausente);
  declarar("estado_poliza", estadoPoliza, estadoPoliza ? CONF.directo : CONF.ausente);
  declarar("comercial", comercial, confComercial);

  const camposExtraidos = Object.entries(confianza)
    .filter(([, c]) => c > 0)
    .map(([k]) => k);

  const extension = path.extname(adjunto).replace(".", "") || "txt";

  return {
    ...valores,
    confianza,
    advertencias,
    meta: {
      es_otrosi: esOtrosi,
      valor_indeterminado: indeterminado,
      plazo_meses: plazoMeses,
      fecha_documento: fechaDocumento,
      fecha_correo: fechaCorreo,
      nombre_adjunto: adjunto,
      extension,
      ruta_adjunto: `fixtures/reto-02/buzon/${correo.id}/${adjunto}`,
      campos_extraidos: camposExtraidos,
      ...(mesAnioFirma && !fechaDocumento
        ? { firma_mes_anio: `${mesAnioFirma.anio}-${String(mesAnioFirma.mes).padStart(2, "0")}` }
        : {}),
    },
  };
}
