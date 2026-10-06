import type { AdaptadorLLM } from "./adapter.ts";
import { env } from "./adapter.ts";
import { crearMock } from "./mock.ts";
import { crearOpenAICompatible } from "./openaiCompatible.ts";
import { crearAnthropic } from "./anthropic.ts";

export function cargarEntorno(): void {
  try {
    const ruta = new URL("../../.env", import.meta.url);
    if (typeof process.loadEnvFile === "function") process.loadEnvFile(ruta);
  } catch {
    // sin .env: se usan variables de entorno del proceso o valores por defecto
  }
}

export function crearAdaptador(): AdaptadorLLM {
  const proveedor = (env("LLM_PROVIDER") ?? "mock").toLowerCase();
  if (proveedor === "anthropic" || proveedor === "claude") return crearAnthropic();
  if (proveedor === "openai" || proveedor === "openai-compatible" || proveedor === "compat") {
    return crearOpenAICompatible();
  }
  return crearMock();
}
