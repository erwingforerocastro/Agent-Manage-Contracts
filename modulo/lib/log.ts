import { anadirLinea, absoluto } from "./paths.ts";
import type { EntradaLog } from "./tipos.ts";

export function registrarLog(
  ctx: { directory: string },
  entrada: Omit<EntradaLog, "ts">,
): void {
  const completa: EntradaLog = { ts: new Date().toISOString(), ...entrada };
  anadirLinea(absoluto(ctx as never, "out/log.jsonl"), JSON.stringify(completa));
}
