import { env } from "./adapter.ts";
import type {
  AdaptadorLLM,
  HerramientaDef,
  Llamada,
  MensajeLLM,
  RespuestaLLM,
} from "./adapter.ts";

type OpcionesOpenAI = {
  apiKey?: string;
  baseUrl?: string;
  modelo?: string;
  timeoutMs?: number;
};

type MensajeOpenAI =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

function convertir(mensajes: MensajeLLM[]): MensajeOpenAI[] {
  const salida: MensajeOpenAI[] = [];
  for (const m of mensajes) {
    if (m.role === "system" || m.role === "user") {
      salida.push({ role: m.role, content: m.content });
    } else if (m.role === "assistant") {
      const toolCalls = m.toolCalls ?? [];
      if (toolCalls.length === 0) {
        salida.push({ role: "assistant", content: m.content });
      } else {
        salida.push({
          role: "assistant",
          content: m.content === "" ? null : m.content,
          tool_calls: toolCalls.map((t) => ({
            id: t.id,
            type: "function",
            function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) },
          })),
        });
      }
    } else {
      salida.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return salida;
}

export function crearOpenAICompatible(opciones: OpcionesOpenAI = {}): AdaptadorLLM {
  const modelo = opciones.modelo ?? env("LLM_MODELO") ?? env("LLM_MODEL") ?? "gpt-4o-mini";
  return {
    nombre: "openai",
    modelo,
    async enviar(mensajes: MensajeLLM[], herramientas: HerramientaDef[]): Promise<RespuestaLLM> {
      const apiKey = opciones.apiKey ?? env("LLM_API_KEY") ?? "";
      if (!apiKey) {
        return {
          error:
            "falta LLM_API_KEY. Copia .env.example a .env y configura la llave, o usa LLM_PROVIDER=mock.",
        };
      }
      const base = (opciones.baseUrl ?? env("LLM_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");
      const cuerpo = {
        model: modelo,
        temperature: 0,
        messages: convertir(mensajes),
        tools: herramientas.map((h) => ({
          type: "function",
          function: { name: h.name, description: h.description, parameters: h.parameters },
        })),
      };

      const control = new AbortController();
      const tiempo = opciones.timeoutMs ?? Number(env("LLM_TIMEOUT_MS") ?? 60000);
      const reloj = setTimeout(() => control.abort(), tiempo);
      try {
        const respuesta = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(cuerpo),
          signal: control.signal,
        });
        if (!respuesta.ok) {
          const detalle = (await respuesta.text().catch(() => "")).slice(0, 300);
          return { error: `el proveedor respondio HTTP ${respuesta.status}: ${detalle}` };
        }
        const datos = (await respuesta.json()) as {
          choices?: {
            message?: {
              content?: string | null;
              tool_calls?: {
                id: string;
                function: { name: string; arguments: string };
              }[];
            };
          }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const mensaje = datos.choices?.[0]?.message;
        if (!mensaje) return { error: "el proveedor devolvio una respuesta vacia" };
        const llamadas: Llamada[] = (mensaje.tool_calls ?? []).map((tc) => {
          let args: unknown = {};
          try {
            args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            args = {};
          }
          return { id: tc.id, name: tc.function.name, args };
        });
        return {
          texto: mensaje.content ?? undefined,
          toolCalls: llamadas.length > 0 ? llamadas : undefined,
          uso: {
            prompt: datos.usage?.prompt_tokens ?? 0,
            completion: datos.usage?.completion_tokens ?? 0,
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
