import fs from "node:fs";
import path from "node:path";

const RAIZ = process.cwd();
const DESTINO = path.join(RAIZ, "modulo");

function leer(rel: string): string {
  return fs.readFileSync(path.join(RAIZ, rel), "utf8");
}

function escribir(rel: string, contenido: string): void {
  const abs = path.join(RAIZ, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contenido, "utf8");
}

function copiarArchivo(origenRel: string, destinoRel: string): void {
  const origen = path.join(RAIZ, origenRel);
  const destino = path.join(RAIZ, destinoRel);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origen, destino);
}

function copiarArbol(origenRel: string, destinoRel: string): void {
  const origen = path.join(RAIZ, origenRel);
  if (!fs.existsSync(origen)) return;
  for (const entrada of fs.readdirSync(origen, { withFileTypes: true })) {
    const relOrigen = path.posix.join(origenRel.replace(/\\/g, "/"), entrada.name);
    const relDestino = path.posix.join(destinoRel, entrada.name);
    if (entrada.isDirectory()) copiarArbol(relOrigen, relDestino);
    else if (entrada.name.endsWith(".ts")) copiarArchivo(relOrigen, relDestino);
  }
}

function limpiar(): void {
  fs.rmSync(DESTINO, { recursive: true, force: true });
  fs.mkdirSync(DESTINO, { recursive: true });
}

const DESCRIPCION_AGENTE =
  "Agente de Registro de Contratos Vigentes: lee el buzón de contratos, extrae y valida los datos, archiva los contratos limpios, pide confirmación humana para los campos dudosos y genera el reporte de alertas.";

limpiar();

const prompt = leer("agent/prompt.md").trimEnd();
escribir(
  "modulo/agent.md",
  [
    "---",
    `description: ${DESCRIPCION_AGENTE}`,
    "mode: primary",
    "permission:",
    "  edit: deny",
    "  bash: deny",
    "---",
    "",
    prompt,
    "",
  ].join("\n"),
);

copiarArbol("src/tools", "modulo/tools");
copiarArbol("src/lib", "modulo/lib");
copiarArchivo("src/agent/session.ts", "modulo/agent/session.ts");
copiarArchivo("src/agent/registry.ts", "modulo/agent/registry.ts");
copiarArchivo("src/llm/adapter.ts", "modulo/llm/adapter.ts");

const conocimiento = leer("src/knowledge/registro-contratos.md").trimEnd();
escribir(
  "modulo/skill/registro-contratos/SKILL.md",
  [
    "---",
    "name: registro-contratos",
    `description: Reglas del proceso de registro de contratos vigentes: buzón, maestro, clasificación, confianza por campo, fechas, confirmación humana y alertas.`,
    "---",
    "",
    conocimiento,
    "",
  ].join("\n"),
);

escribir(
  "modulo/README.md",
  [
    "# Módulo reutilizable: Registro de Contratos Vigentes",
    "",
    "Generado con `npm run sync-modulo` desde la misma fuente que usa la aplicación.",
    "**No editar a mano**: cualquier cambio se hace en `agent/prompt.md`,",
    "`src/tools/`, `src/lib/`, `src/agent/` o `src/knowledge/` y se vuelve a sincronizar.",
    "",
    "| Pieza | Origen |",
    "|---|---|",
    "| `agent.md` | `agent/prompt.md` + frontmatter (`mode: primary`, `permission: {edit: deny, bash: deny}`) |",
    "| `tools/contratos.ts` | `src/tools/contratos.ts` (idéntico, mismos imports relativos) |",
    "| `lib/`, `agent/session.ts`, `agent/registry.ts`, `llm/adapter.ts` | dependencias de las herramientas |",
    "| `skill/registro-contratos/SKILL.md` | `src/knowledge/registro-contratos.md` + frontmatter |",
    "",
    "## Uso",
    "",
    "```ts",
    'import { construirRegistro, ejecutarHerramienta } from "./modulo/agent/registry.ts";',
    'import { contratos_leer_buzon } from "./modulo/tools/contratos.ts";',
    "",
    'const registro = construirRegistro();          // [{ nombre: "contratos_leer_buzon", ... }]',
    'const ctx = { directory: process.cwd(), sessionId: "host", hoy: "2026-09-03" };',
    'const { resultado, ok } = await ejecutarHerramienta(registro, "contratos_leer_buzon", {}, ctx);',
    "```",
    "",
    "- `ctx.directory` debe apuntar a la raíz del proyecto (donde viven `fixtures/` y `out/`).",
    "- Las herramientas son funciones `zod` + `execute`; nunca lanzan y siempre devuelven",
    "  `{ ok: true, data }` o `{ ok: false, error }`.",
    "- Requiere un runtime con TypeScript nativo (Node ≥ 22.18 o Bun) y `zod` instalado.",
    "",
  ].join("\n"),
);

const archivos: string[] = [];
function listar(dir: string): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) listar(abs);
    else archivos.push(path.relative(DESTINO, abs).replace(/\\/g, "/"));
  }
}
listar(DESTINO);
console.log(`modulo/ sincronizado con ${archivos.length} archivo(s):`);
for (const a of archivos.sort()) console.log(`  - ${a}`);
