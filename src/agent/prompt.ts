import path from "node:path";
import { fileURLToPath } from "node:url";
import { existe, leerTexto } from "../lib/paths.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));

export function cargarPromptSistema(): string {
  const candidatas = [
    path.join(dir, "..", "..", "agent", "prompt.md"),
    path.join(dir, "..", "knowledge", "registro-contratos.md"),
  ];
  const partes = candidatas.filter(existe).map((ruta) => leerTexto(ruta));
  if (partes.length === 0) {
    return "Eres un agente de registro de contratos. Responde en español y usa las herramientas disponibles.";
  }
  return partes.join("\n\n---\n\n");
}
