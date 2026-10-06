import { z } from "zod";
import type { Ctx } from "../lib/paths.ts";
import * as contratos from "../tools/contratos.ts";

export type Herramienta = {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (args: never, ctx: Ctx) => Promise<string>;
};

export type HerramientaRegistrada = {
  nombre: string;
  description: string;
  schema: z.ZodTypeAny;
  parametros: Record<string, unknown>;
  execute: (args: unknown, ctx: Ctx) => Promise<string>;
};

function esHerramienta(valor: unknown): valor is Herramienta {
  if (typeof valor !== "object" || valor === null) return false;
  const obj = valor as Record<string, unknown>;
  return typeof obj.description === "string" && typeof obj.execute === "function" && typeof obj.args === "object";
}

export function construirRegistro(): HerramientaRegistrada[] {
  const registro: HerramientaRegistrada[] = [];
  for (const [nombre, valor] of Object.entries(contratos)) {
    if (!esHerramienta(valor)) continue;
    const schema = z.object(valor.args);
    const json = z.toJSONSchema(schema) as Record<string, unknown>;
    delete json.$schema;
    registro.push({
      nombre: `contratos_${nombre}`,
      description: valor.description,
      schema,
      parametros: json,
      execute: (args, ctx) => valor.execute(args as never, ctx),
    });
  }
  return registro;
}

export type ResultadoEjecucion = { resultado: string; ok: boolean };

export async function ejecutarHerramienta(
  registro: HerramientaRegistrada[],
  nombre: string,
  args: unknown,
  ctx: Ctx,
): Promise<ResultadoEjecucion> {
  const herramienta = registro.find((h) => h.nombre === nombre);
  if (!herramienta) {
    return {
      resultado: JSON.stringify({
        ok: false,
        error: `herramienta desconocida: ${nombre}. Disponibles: ${registro.map((h) => h.nombre).join(", ")}`,
      }),
      ok: false,
    };
  }
  const parse = herramienta.schema.safeParse(args ?? {});
  if (!parse.success) {
    const detalle = parse.error.issues
      .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(raíz)"}: ${i.message}`)
      .join("; ");
    return {
      resultado: JSON.stringify({
        ok: false,
        error: `argumentos inválidos para ${nombre}: ${detalle}`,
      }),
      ok: false,
    };
  }
  try {
    const resultado = await herramienta.execute(parse.data, ctx);
    let ok = false;
    try {
      ok = (JSON.parse(resultado) as { ok?: boolean }).ok === true;
    } catch {
      ok = false;
    }
    return { resultado, ok };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return {
      resultado: JSON.stringify({ ok: false, error: `fallo inesperado en ${nombre}: ${error}` }),
      ok: false,
    };
  }
}
