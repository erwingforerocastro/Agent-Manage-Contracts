import { z } from "zod";

export const PAISES = ["CO", "EC", "PE", "PA", "HN"] as const;
export const MONEDAS = ["COP", "USD", "PEN", "PAB", "HNL"] as const;
export const ESTADOS_POLIZA = ["vigente", "pendiente", "vencida", "no_aplica"] as const;
export const CLASIFICACIONES = ["nuevo", "actualizacion", "duplicado", "rechazado"] as const;

export const COLUMNAS_MAESTRO = [
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
  "ruta_sharepoint",
  "fecha_registro",
  "fuente",
] as const;

export const CAMPOS_DATO = [
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
] as const;

export type Clasificacion = (typeof CLASIFICACIONES)[number];

export const contratoZod = z.object({
  es_contrato: z.boolean().describe("true si el adjunto es un contrato identificable"),
  motivo_rechazo: z
    .string()
    .nullable()
    .describe("motivo cuando es_contrato es false"),
  id_contrato: z.string().nullable().describe("número del contrato o null"),
  cliente: z.string().nullable().describe("razón social de la contraparte"),
  nit_cliente: z.string().nullable().describe("identificador tributario sin puntos ni DV"),
  pais: z.enum(PAISES).nullable().describe("CO|EC|PE|PA|HN"),
  objeto: z.string().nullable().describe("objeto del contrato, máx. 200 caracteres"),
  valor: z.number().nullable().describe("valor numérico sin separadores; 0 si es indeterminado"),
  moneda: z.enum(MONEDAS).nullable().describe("COP|USD|PEN|PAB|HNL"),
  fecha_inicio: z.string().nullable().describe("YYYY-MM-DD o null"),
  fecha_fin: z.string().nullable().describe("YYYY-MM-DD o null"),
  requiere_poliza: z.boolean().nullable().describe("si el contrato exige póliza"),
  tipo_poliza: z.string().nullable().describe("lista separada por ; o null"),
  estado_poliza: z.enum(ESTADOS_POLIZA).nullable().describe("estado inicial de la póliza"),
  comercial: z.string().nullable().describe("nombre resuelto desde comerciales.json"),
  confianza: z
    .record(z.string(), z.number())
    .describe("confianza [0,1] por campo de la sección 7.2"),
  advertencias: z.array(z.string()).describe("avisos no bloqueantes (p.ej. remitente desconocido)"),
  meta: z.record(z.string(), z.unknown()).describe("metadatos de la extracción"),
});

export type Contrato = z.infer<typeof contratoZod>;

export type Cambio = {
  campo: string;
  anterior: string;
  nuevo: string;
};

export type ResultadoValidacion = {
  clasificacion: Clasificacion;
  id_contrato_existente?: string;
  requiere_revision: string[];
  diferencias: Cambio[];
  advertencias: string[];
  motivo?: string;
};

export type FilaMaestro = {
  id_contrato: string;
  cliente: string;
  nit_cliente: string;
  pais: string;
  objeto: string;
  valor: number;
  moneda: string;
  fecha_inicio: string;
  fecha_fin: string;
  requiere_poliza: boolean;
  tipo_poliza: string;
  estado_poliza: string;
  comercial: string;
  ruta_sharepoint: string;
  fecha_registro: string;
  fuente: string;
};

export type Correo = {
  id: string;
  de: string;
  para: string;
  asunto: string;
  fecha: string;
  cuerpo: string;
  adjuntos: string[];
};

export type EntradaHistorial = {
  ts: string;
  id_contrato: string;
  accion: "nuevo" | "actualizacion" | "rechazado" | "duplicado";
  cambios: Cambio[];
  mensaje_id: string;
  ruta_documento?: string;
};

export type EntradaLog = {
  ts: string;
  herramienta: string;
  mensaje_id?: string;
  ok: boolean;
  resumen: string;
};
