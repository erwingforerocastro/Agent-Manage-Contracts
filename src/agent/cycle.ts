import type { Ctx } from "../lib/paths.ts";
import { enCola } from "../lib/paths.ts";
import type { AdaptadorLLM, HerramientaDef, MensajeLLM } from "../llm/adapter.ts";
import { construirRegistro, ejecutarHerramienta, type HerramientaRegistrada } from "./registry.ts";
import {
  agregarEntrada,
  cargarSesion,
  guardarSesion,
  registrarLlamada,
  sumarTokens,
} from "./session.ts";

export type Deps = {
  adaptador: AdaptadorLLM;
  promptSistema: string;
  maxIteraciones: number;
  maxTokensSesion: number;
  registro?: HerramientaRegistrada[];
};

export type LlamadaVisible = {
  id: string;
  nombre: string;
  args: unknown;
  resultado: string;
  ok: boolean;
};

export type ResultadoTurno = {
  reply: string;
  toolCalls: LlamadaVisible[];
  needsConfirmation: boolean;
  iteraciones: number;
  error?: string;
};

const AVISO_TOPE =
  "Alcanzé el tope de iteraciones de este turno. Esto es lo que tengo hasta ahora y lo que falta por hacer.";

export async function ejecutarTurno(
  deps: Deps,
  ctx: Ctx,
  textoUsuario: string,
): Promise<ResultadoTurno> {
  const registro = deps.registro ?? construirRegistro();
  const defs: HerramientaDef[] = registro.map((h) => ({
    name: h.nombre,
    description: h.description,
    parameters: h.parametros,
  }));
  const sesionInicial = cargarSesion(ctx, ctx.sessionId);
  const usados = sesionInicial.tokens.prompt + sesionInicial.tokens.completion; 
  if (usados >= deps.maxTokensSesion) {
    return {
      reply:
        "Se alcanzó el límite de tokens configurado para esta sesión. Abre una sesión nueva para continuar.",
      toolCalls: [],
      needsConfirmation: Object.keys(sesionInicial.pendientes).length > 0,
      iteraciones: 0,
      error: "limite_tokens",
    };
  }

  await agregarEntrada(ctx, ctx.sessionId, { role: "user", content: textoUsuario });

  const construirMensajes = (): MensajeLLM[] => {
    const actual = cargarSesion(ctx, ctx.sessionId);
    const lista: MensajeLLM[] = [
      { role: "system", content: deps.promptSistema },
      ...actual.mensajes,
    ];
    if (ctx.hoy) {
      for (let i = lista.length - 1; i >= 0; i -= 1) {
        const mensaje = lista[i];
        if (mensaje && mensaje.role === "user") {
          if (!mensaje.content.includes(ctx.hoy as string)) {
            lista[i] = {
              ...mensaje,
              content: `${mensaje.content}\n\nFecha de hoy: ${ctx.hoy}`,
            };
          }
          break;
        }
      }
    }
    return lista;
  };

  const visibles: LlamadaVisible[] = [];
  let iteraciones = 0;
  let reply = "";

  while (iteraciones < deps.maxIteraciones) {
    const actual = cargarSesion(ctx, ctx.sessionId);
    const consumido = actual.tokens.prompt + actual.tokens.completion;
    if (consumido >= deps.maxTokensSesion) {
      reply = `Se alcanzó el límite de tokens de la sesión (${consumido}/${deps.maxTokensSesion}). No puedo seguir llamando herramientas; abre una sesión nueva.`;
      break;
    }

    iteraciones += 1;
    const respuesta = await deps.adaptador.enviar(construirMensajes(), defs);

    if (respuesta.error) {
      reply = `No pude obtener respuesta del modelo: ${respuesta.error}. La sesión sigue viva, vuelve a enviar el mensaje.`;
      await agregarEntrada(ctx, ctx.sessionId, { role: "assistant", content: reply });
      break;
    }

    if (respuesta.uso) {
      await sumarTokens(ctx, ctx.sessionId, respuesta.uso.prompt, respuesta.uso.completion);
    }

    const llamadas = respuesta.toolCalls ?? [];
    if (llamadas.length === 0) {
      reply = (respuesta.texto ?? "").trim() || "…";
      await agregarEntrada(ctx, ctx.sessionId, { role: "assistant", content: reply });
      break;
    }

    await agregarEntrada(ctx, ctx.sessionId, {
      role: "assistant",
      content: respuesta.texto ?? "",
      toolCalls: llamadas,
    });

    for (const llamada of llamadas) {
      const { resultado, ok } = await ejecutarHerramienta(
        registro,
        llamada.name,
        llamada.args,
        ctx,
      );
      await agregarEntrada(ctx, ctx.sessionId, {
        role: "tool",
        toolCallId: llamada.id,
        name: llamada.name,
        content: resultado,
      });
      visibles.push({
        id: llamada.id,
        nombre: llamada.name,
        args: llamada.args,
        resultado,
        ok,
      });
      await registrarLlamada(ctx, ctx.sessionId, {
        id: llamada.id,
        nombre: llamada.name,
        args: llamada.args,
        resultado,
        ok,
        iteracion: iteraciones,
      });
    }
  }

  if (reply === "") {
    const mensajes = [
      ...construirMensajes(),
      {
        role: "user" as const,
        content:
          "Sin herramientas disponibles: resume con lo que ya obtuviste, indica qué falta y qué decisión humana necesitas.",
      },
    ];
    const cierre = await deps.adaptador.enviar(mensajes, []);
    reply =
      cierre.error || !(cierre.texto ?? "").trim()
        ? AVISO_TOPE
        : (cierre.texto ?? "").trim();
    await agregarEntrada(ctx, ctx.sessionId, { role: "assistant", content: reply });
  }

  await enCola(() => {
    const sesion = cargarSesion(ctx, ctx.sessionId);
    sesion.turnos += 1;
    guardarSesion(ctx, sesion);
  });
  const sesionFinal = cargarSesion(ctx, ctx.sessionId);

  return {
    reply,
    toolCalls: visibles,
    needsConfirmation: Object.keys(sesionFinal.pendientes).length > 0,
    iteraciones,
  };
}
