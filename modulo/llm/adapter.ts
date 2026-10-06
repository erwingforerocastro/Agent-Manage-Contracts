export type Llamada = {
  id: string;
  name: string;
  args: unknown;
};

export type MensajeLLM =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: Llamada[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type HerramientaDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type RespuestaLLM = {
  texto?: string;
  toolCalls?: Llamada[];
  uso?: { prompt: number; completion: number };
  error?: string;
};

export interface AdaptadorLLM {
  nombre: string;
  modelo: string;
  enviar(mensajes: MensajeLLM[], herramientas: HerramientaDef[]): Promise<RespuestaLLM>;
}

export function env(nombre: string): string | undefined {
  const valor = process.env[nombre];
  return valor !== undefined && valor.trim() !== "" ? valor.trim() : undefined;
}

export function ultimoUsuario(mensajes: MensajeLLM[]): string {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    if (m && m.role === "user") return m.content;
  }
  return "";
}
