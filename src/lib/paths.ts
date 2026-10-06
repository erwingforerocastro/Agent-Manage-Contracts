import fs from "node:fs";
import path from "node:path";

export type Ctx = {
  directory: string;
  sessionId: string;
  hoy?: string;
};

export function esRelativaSegura(rel: string): boolean {
  if (!rel || rel.includes("\\")) return false;
  if (rel.startsWith("/")) return false;
  if (/^[a-zA-Z]:/.test(rel)) return false;
  for (const parte of rel.split("/")) {
    if (parte === "..") return false;
  }
  return true;
}

export function absoluto(ctx: Ctx, rel: string): string {
  const partes = rel.split("/").filter((p) => p !== "" && p !== ".");
  return path.join(ctx.directory, ...partes);
}

export function rutaPosix(...partes: (string | number)[]): string {
  return partes
    .map((p) => String(p))
    .filter((p) => p !== "")
    .join("/");
}

export function leerTexto(abs: string): string {
  return fs.readFileSync(abs, "utf8");
}

export function existe(abs: string): boolean {
  return fs.existsSync(abs);
}

export function asegurarDir(abs: string): void {
  fs.mkdirSync(abs, { recursive: true });
}

export function escribirTexto(abs: string, contenido: string): void {
  asegurarDir(path.dirname(abs));
  const temporal = `${abs}.tmp`;
  fs.writeFileSync(temporal, contenido, "utf8");
  fs.renameSync(temporal, abs);
}

let cola: Promise<unknown> = Promise.resolve();

export function enCola<T>(tarea: () => T | Promise<T>): Promise<T> {
  const ejecucion = cola.then(tarea, tarea) as Promise<T>;
  cola = ejecucion.then(
    () => undefined,
    () => undefined,
  );
  return ejecucion;
}

export function anadirLinea(abs: string, linea: string): void {
  asegurarDir(path.dirname(abs));
  fs.appendFileSync(abs, linea.endsWith("\n") ? linea : `${linea}\n`, "utf8");
}

export function limpiarDirectorio(abs: string): void {
  fs.rmSync(abs, { recursive: true, force: true });
}
