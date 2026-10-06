import http from "node:http";
import path from "node:path";
import { ejecutarTurno, type Deps } from "./agent/cycle.ts";
import { cargarPromptSistema } from "./agent/prompt.ts";
import { construirRegistro } from "./agent/registry.ts";
import { cargarSesion, leerPendientes } from "./agent/session.ts";
import { crearAdaptador, cargarEntorno } from "./llm/index.ts";
import { env } from "./llm/adapter.ts";
import { leerHistorial, leerMaestro } from "./lib/maestro.ts";
import { leerProcesados } from "./lib/buzon.ts";
import { existe, leerTexto, type Ctx } from "./lib/paths.ts";
import { hoyISO } from "./lib/fechas.ts";

cargarEntorno();

const RAIZ = process.cwd();
const dirWeb = path.join(RAIZ, "web");
const adaptador = crearAdaptador();

const deps: Deps = {
  adaptador,
  promptSistema: cargarPromptSistema(),
  maxIteraciones: Number(env("AGENT_MAX_ITERACIONES") ?? env("ITERACIONES_MAX") ?? 25),
  maxTokensSesion: Number(env("AGENT_MAX_TOKENS_SESION") ?? env("TOKENS_SESION_MAX") ?? 200000),
  registro: construirRegistro(),
};

const estaticos: Record<string, { archivo: string; tipo: string }> = {
  "/": { archivo: "index.html", tipo: "text/html; charset=utf-8" },
  "/index.html": { archivo: "index.html", tipo: "text/html; charset=utf-8" },
  "/app.js": { archivo: "app.js", tipo: "text/javascript; charset=utf-8" },
  "/styles.css": { archivo: "styles.css", tipo: "text/css; charset=utf-8" },
};

function json(res: http.ServerResponse, codigo: number, datos: unknown): void {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(codigo, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(cuerpo);
}

function leerCuerpo(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let acumulado = "";
    req.on("data", (pedazo: Buffer) => {
      acumulado += pedazo.toString("utf8");
      if (acumulado.length > 1_000_000) {
        reject(new Error("cuerpo demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (acumulado.trim() === "") return resolve({});
      try {
        resolve(JSON.parse(acumulado) as Record<string, unknown>);
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

function ctxDe(sessionId: string, hoy?: string): Ctx {
  return { directory: RAIZ, sessionId, hoy: hoy || undefined };
}

function ultimasLineas(ruta: string, cantidad: number): string[] {
  if (!existe(ruta)) return [];
  const texto = leerTexto(ruta);
  const lineas = texto.split("\n").filter((l) => l.trim() !== "");
  return lineas.slice(-cantidad);
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET") {
      const estatico = estaticos[url.pathname];
      if (estatico) {
        const ruta = path.join(dirWeb, estatico.archivo);
        if (!existe(ruta)) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          return res.end("falta el archivo web");
        }
        res.writeHead(200, { "content-type": estatico.tipo });
        return res.end(leerTexto(ruta));
      }

      if (url.pathname.startsWith("/api/sessions/") || url.pathname.startsWith("/api/sesion/")) {
        const prefijo = url.pathname.startsWith("/api/sessions/")
          ? "/api/sessions/"
          : "/api/sesion/";
        const id = decodeURIComponent(url.pathname.slice(prefijo.length)) || "default";
        return json(res, 200, cargarSesion(ctxDe(id), id));
      }

      if (url.pathname === "/api/health") {
        return json(res, 200, {
          ok: true,
          provider: adaptador.nombre,
          model: adaptador.modelo,
          maxIteraciones: deps.maxIteraciones,
        });
      }

      if (url.pathname === "/api/estado") {
        const ctx = ctxDe("default");
        const log = ultimasLineas(path.join(RAIZ, "out", "log.jsonl"), 50)
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter((e) => e !== null);
        return json(res, 200, {
          adaptador: { proveedor: adaptador.nombre, modelo: adaptador.modelo },
          maestro: leerMaestro(ctx),
          procesados: leerProcesados(ctx),
          historial: leerHistorial(ctx),
          pendientes: leerPendientes(ctx),
          log,
          fecha: hoyISO(),
        });
      }

      if (url.pathname === "/api/alertas") {
        const ruta = path.join(RAIZ, "out", "alertas.md");
        return json(res, 200, { texto: existe(ruta) ? leerTexto(ruta) : "" });
      }

      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("no encontrado");
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const cuerpo = await leerCuerpo(req);
      const mensaje = typeof cuerpo.message === "string" ? cuerpo.message.trim() : "";
      if (mensaje === "") return json(res, 400, { error: "message vacío" });
      const sessionId =
        typeof cuerpo.sessionId === "string" && cuerpo.sessionId.trim() !== ""
          ? cuerpo.sessionId.trim()
          : "default";
      const hoy = typeof cuerpo.hoy === "string" ? cuerpo.hoy : undefined;
      const resultado = await ejecutarTurno(deps, ctxDe(sessionId, hoy), mensaje);
      return json(res, 200, {
        reply: resultado.reply,
        toolCalls: resultado.toolCalls,
        needsConfirmation: resultado.needsConfirmation,
        iteraciones: resultado.iteraciones,
        error: resultado.error,
        sessionId,
      });
    }

    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("método no permitido");
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    json(res, 500, { error });
  }
});

const puerto = Number(env("PORT") ?? 3000) || 3000;
servidor.listen(puerto, () => {
  console.log(`Agente de contratos escuchando en http://localhost:${puerto}`);
  console.log(`Adaptador LLM: ${adaptador.nombre} (${adaptador.modelo})`);
});
