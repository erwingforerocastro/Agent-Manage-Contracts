# Módulo reutilizable: Registro de Contratos Vigentes

Generado con `npm run sync-modulo` desde la misma fuente que usa la aplicación.
**No editar a mano**: cualquier cambio se hace en `agent/prompt.md`,
`src/tools/`, `src/lib/`, `src/agent/` o `src/knowledge/` y se vuelve a sincronizar.

| Pieza | Origen |
|---|---|
| `agent.md` | `agent/prompt.md` + frontmatter (`mode: primary`, `permission: {edit: deny, bash: deny}`) |
| `tools/contratos.ts` | `src/tools/contratos.ts` (idéntico, mismos imports relativos) |
| `lib/`, `agent/session.ts`, `agent/registry.ts`, `llm/adapter.ts` | dependencias de las herramientas |
| `skill/registro-contratos/SKILL.md` | `src/knowledge/registro-contratos.md` + frontmatter |

## Uso

```ts
import { construirRegistro, ejecutarHerramienta } from "./modulo/agent/registry.ts";
import { contratos_leer_buzon } from "./modulo/tools/contratos.ts";

const registro = construirRegistro();          // [{ nombre: "contratos_leer_buzon", ... }]
const ctx = { directory: process.cwd(), sessionId: "host", hoy: "2026-09-03" };
const { resultado, ok } = await ejecutarHerramienta(registro, "contratos_leer_buzon", {}, ctx);
```

- `ctx.directory` debe apuntar a la raíz del proyecto (donde viven `fixtures/` y `out/`).
- Las herramientas son funciones `zod` + `execute`; nunca lanzan y siempre devuelven
  `{ ok: true, data }` o `{ ok: false, error }`.
- Requiere un runtime con TypeScript nativo (Node ≥ 22.18 o Bun) y `zod` instalado.
