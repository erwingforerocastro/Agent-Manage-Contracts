import { env } from "./adapter.ts";
import type {
  AdaptadorLLM,
  HerramientaDef,
  Llamada,
  MensajeLLM,
  RespuestaLLM,
} from "./adapter.ts";

type OpcionesAnthropic = {
  apiKey?: string;
  baseUrl?: string;
  modelo?: string;
  maxTokens?: number;
  timeoutMs?: number;
};

type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

type MensajeAnthropic = { role: "assistant" | "user"; content: Bloque[] };

function convertir(mensajes: MensajeLLM[]): { system: string; mensajes: MensajeAnthropic[] } {
  const sistema = mensajes
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const salida: MensajeAnthropic[] = [];
  const agregar = (rol: "assistant" | "user", bloque: Bloque): void => {
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.role === rol) ultimo.content.push(bloque);
    else salida.push({ role: rol, content: [bloque] });
  };
  for (const m of mensajes) {
    if (m.role === "system") continue;
    if (m.role === "user") agregar("user", { type: "text", text: m.content });
    else if (m.role === "assistant") {
      if (m.content) agregar("assistant", { type: "text", text: m.content });
      for (const t of m.toolCalls ?? []) {
        agregar("assistant", { type: "tool_use", id: t.id, name: t.name, input: t.args ?? {} });
      }
    } else {
      agregar("user", { type: "tool_result", tool_use_id: m.toolCallId, content: m.content });
    }
  }
  const primero = salida[0];
  if (primero && primero.role !== "user") {
    salida.unshift({ role: "user", content: [{ type: "text", text: "(continÃºa)" }] });
  }
  return { system: sistema, mensajes: salida };
}

export function crearAnthropic(opciones: OpcionesAnthropic = {}): AdaptadorLLM {
  const modelo = opciones.modelo ?? env("LLM_MODELO") ?? env("LLM_MODEL") ?? "claude-sonnet-4-5";
  return {
    nombre: "anthropic",
    modelo,
    async enviar(mensajes: MensajeLLM[], herramientas: HerramientaDef[]): Promise<RespuestaLLM> {
      const apiKey = opciones.apiKey ?? env("LLM_API_KEY") ?? "";
      if (!apiKey) {
        return {
          error:
            "falta LLM_API_KEY. Copia .env.example a .env y configura la llave, o usa LLM_PROVIDER=mock.",
        };
      }
      const base = (opciones.baseUrl ?? env("LLM_BASE_URL") ?? "https://api.anthropic.com").replace(
        /\/+$/,
        "",
      );
      const { system, mensajes: convertidos } = convertir(mensajes);
      const cuerpo = {
        model: modelo,
        max_tokens: opciones.maxTokens ?? 4096,
        temperature: 0,
        system,
        messages: convertidos,
        tools: herramientas.map((h) => ({
          name: h.name,
          description: h.description,
          input_schema: h.parameters,
        })),
      };

      const control = new AbortController();
      const tiempo = opciones.timeoutMs ?? Number(env("LLM_TIMEOUT_MS") ?? 60000);
      const reloj = setTimeout(() => control.abort(), tiempo);
      try {
        const respuesta = await fetch(`${base}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(cuerpo),
          signal: control.signal,
        });
        if (!respuesta.ok) {
          const detalle = (await respuesta.text().catch(() => "")).slice(0, 300);
          return { error: `el proveedor respondiÃ³ HTTP ${respuesta.status}: ${detalle}` };
        }
        const datos = (await respuesta.json()) as {
          content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const bloques = datos.content ?? [];
        let texto = "";
        const llamadas: Llamada[] = [];
        for (const bloque of bloques) {
          if (bloque.type === "text") texto += bloque.text ?? "";
          else if (bloque.type === "tool_use" && bloque.id && bloque.name) {
            llamadas.push({ id: bloque.id, name: bloque.name, args: bloque.input ?? {} });
          }
        }
        return {
          texto: texto.trim() || undefined,
          toolCalls: llamadas.length > 0 ? llamadas : undefined,
          uso: {
            prompt: datos.usage?.input_tokens ?? 0,
            completion: datos.usage?.output_tokens ?? 0,
          },
        };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        return {
          error:
            error.includes("abort")
              ? `el proveedor no respondiÃ³ en ${tiempo} ms`
              : `no se pudo contactar al proveedor: ${error}`,
        };
      } finally {
        clearTimeout(reloj);
      }
    },
  };
}
