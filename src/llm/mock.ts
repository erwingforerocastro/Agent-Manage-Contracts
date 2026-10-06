import type { AdaptadorLLM, HerramientaDef, MensajeLLM, RespuestaLLM } from "./adapter.ts";
import { ultimoUsuario } from "./adapter.ts";
import { hoyISO } from "../lib/fechas.ts";

type Resultado = { ok: boolean; data?: Record<string, unknown>; error?: string };

type Paso = {
  name: string;
  args: Record<string, unknown>;
  result: Resultado;
};

type MensajeBuzonMock = {
  id: string;
  de: string;
  asunto: string;
  fecha: string;
  adjuntos: string[];
  tiene_contrato: boolean;
};

function parsearJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

function construirHistorial(mensajes: MensajeLLM[]): Paso[] {
  const historial: Paso[] = [];
  let pendientes: { id: string; name: string; args: Record<string, unknown> }[] = [];
  for (const mensaje of mensajes) {
    if (mensaje.role === "assistant") {
      for (const llamada of mensaje.toolCalls ?? []) {
        pendientes.push({
          id: llamada.id,
          name: llamada.name,
          args: (llamada.args ?? {}) as Record<string, unknown>,
        });
      }
    }
    if (mensaje.role === "tool") {
      const coincide = pendientes.find((p) => p.id === mensaje.toolCallId);
      const resultado = parsearJson(mensaje.content) as Resultado | null;
      if (coincide && resultado) {
        historial.push({ name: coincide.name, args: coincide.args, result: resultado });
      }
      pendientes = pendientes.filter((p) => p.id !== mensaje.toolCallId);
    }
  }
  return historial;
}

function esConfirmacion(texto: string): boolean {
  return /\bconfirmo\b|\bconfirmado\b|\baprobar? aprobado\b/i.test(texto);
}

function tieneClaveDeProceso(texto: string): boolean {
  return /buz|contrat|proces|alert|registr|revis|msg-\d/i.test(texto);
}

function fechaObjetivo(texto: string): string {
  const explicita = texto.match(/fecha (?:de )?hoy\s*:?\s*\b(\d{4}-\d{2}-\d{2})\b/i);
  if (explicita && explicita[1]) return explicita[1];
  return hoyISO();
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function comoTexto(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  return String(valor);
}

export function crearMock(): AdaptadorLLM {
  return {
    nombre: "mock",
    modelo: "mock-determinista",
    async enviar(mensajes: MensajeLLM[], herramientas: HerramientaDef[]): Promise<RespuestaLLM> {
      const historial = construirHistorial(mensajes);
      const textoUsuario = ultimoUsuario(mensajes);
      const uso = {
        prompt: Math.max(1, Math.round(JSON.stringify(mensajes).length / 4)),
        completion: 60,
      };

      if (herramientas.length === 0) {
        return {
          texto:
            "Alcancé el tope de iteraciones de este turno. Con lo obtenido hasta aquí puedo darte el resumen; si quieres, vuelve a pedirme el reporte y continúo con lo pendiente.",
          uso,
        };
      }

      const pasoBuzon = historial.find(
        (h) => h.name === "contratos_leer_buzon" && h.result.ok,
      );
      const idAsignado = `call_${historial.length + 1}`;

      const llamar = (name: string, args: Record<string, unknown>): RespuestaLLM => ({
        toolCalls: [{ id: idAsignado, name, args }],
        uso,
      });

      if (!pasoBuzon && historial.length === 0 && !tieneClaveDeProceso(textoUsuario)) {
        return {
          texto: `Hola. Soy el agente de Registro de Contratos Vigentes. Puedo leer el buzón, extraer y validar cada contrato, archivarlo y generar alertas.\n\nEscribe: **Procesa el buzón de contratos con fecha de hoy ${hoyISO()}** y empiezo.`,
          uso,
        };
      }

      if (!pasoBuzon) {
        return llamar("contratos_leer_buzon", {});
      }

      const mensajesBuzon = ((pasoBuzon.result.data?.mensajes ?? []) as MensajeBuzonMock[]).slice().sort(
        (a, b) => a.fecha.localeCompare(b.fecha),
      );

      const registrosFallidos = historial.filter(
        (h) => h.name === "contratos_registrar" && !h.result.ok && /requiere revisi/i.test(h.result.error ?? ""),
      );
      const pendienteActivo =
        registrosFallidos.find(
          (p) =>
            !historial.some(
              (h) =>
                h.name === "contratos_registrar" &&
                h.args.mensaje_id === p.args.mensaje_id &&
                h.result.ok,
            ),
        ) ?? null;

      if (esConfirmacion(textoUsuario)) {
        if (pendienteActivo) {
          const mensajeId = String(pendienteActivo.args.mensaje_id);
          const extraido = historial.find(
            (h) => h.name === "contratos_extraer" && h.args.mensaje_id === mensajeId && h.result.ok,
          );
          const yaConfirmado = historial.some(
            (h) =>
              h.name === "contratos_registrar" &&
              h.args.mensaje_id === mensajeId &&
              h.args.confirmado === true,
          );
          if (!yaConfirmado && extraido) {
            return llamar("contratos_registrar", {
              mensaje_id: mensajeId,
              contrato: extraido.result.data,
              confirmado: true,
            });
          }
        }
        const idxConfirm = historial.findIndex(
          (h) => h.name === "contratos_registrar" && h.args.confirmado === true,
        );
        const ultimaAlertas = historial.reduce(
          (ultimo, h, i) => (h.name === "contratos_alertas" && h.result.ok ? i : ultimo),
          -1,
        );
        if (idxConfirm >= 0 && ultimaAlertas < idxConfirm) {
          return llamar("contratos_alertas", { hoy: fechaObjetivo(textoUsuario) });
        }
        if (pendienteActivo) {
          return { texto: textoCierre(historial), uso };
        }
      }

      for (const mensaje of mensajesBuzon) {
        const extraido = historial.find(
          (h) => h.name === "contratos_extraer" && h.args.mensaje_id === mensaje.id && h.result.ok,
        );
        if (!extraido) return llamar("contratos_extraer", { mensaje_id: mensaje.id });

        const validado = historial.find(
          (h) => h.name === "contratos_validar" && h.args.mensaje_id === mensaje.id,
        );
        if (!validado) {
          return llamar("contratos_validar", {
            mensaje_id: mensaje.id,
            contrato: extraido.result.data,
          });
        }

        const registrado = historial.find(
          (h) => h.name === "contratos_registrar" && h.args.mensaje_id === mensaje.id,
        );
        if (!registrado) {
          return llamar("contratos_registrar", {
            mensaje_id: mensaje.id,
            contrato: extraido.result.data,
            confirmado: false,
          });
        }
      }

      const ultimaAlertas = historial.filter(
        (h) => h.name === "contratos_alertas" && h.result.ok,
      );
      if (ultimaAlertas.length === 0) {
        return llamar("contratos_alertas", { hoy: fechaObjetivo(textoUsuario) });
      }

      return { texto: textoCierre(historial), uso };
    },
  };
}

function textoCierre(historial: Paso[]): string {
  const lineas: string[] = [];
  lineas.push("### Resultado del procesamiento del buzón");
  lineas.push("");
  lineas.push("| Mensaje | Contrato | Clasificación | Acción | Revisión |");
  lineas.push("|---|---|---|---|---|");

  const mensajes = new Set<string>();
  for (const paso of historial) {
    if (paso.args.mensaje_id) mensajes.add(String(paso.args.mensaje_id));
  }

  for (const id of [...mensajes].sort()) {
    const validado = historial.find((h) => h.name === "contratos_validar" && h.args.mensaje_id === id);
    const registrado = historial
      .filter((h) => h.name === "contratos_registrar" && h.args.mensaje_id === id)
      .pop();
    const extraido = historial.find((h) => h.name === "contratos_extraer" && h.args.mensaje_id === id);

    const clasificacion = String(validado?.result.data?.clasificacion ?? "—");
    const revision = (validado?.result.data?.requiere_revision as string[] | undefined) ?? [];
    let accion = "—";
    if (registrado?.result.ok) {
      const data = registrado.result.data ?? {};
      if (data.accion === "rechazado") {
        accion = "rechazado (sin escritura)";
      } else {
        accion = `${String(data.accion ?? "—")} (${String(data.id_contrato ?? "—")})`;
        if (data.ruta_archivo) accion += ` → \`${String(data.ruta_archivo)}\``;
      }
    } else if (registrado && !registrado.result.ok) {
      accion = "pendiente de confirmación";
    }
    const idContrato = String(extraido?.result.data?.id_contrato ?? "—");
    const revisionTexto =
      revision.length > 0 ? revision.map((c) => `**${c}**`).join(", ") : "—";
    lineas.push(
      `| ${id} | ${idContrato} | ${clasificacion} | ${accion} | ${revisionTexto} |`,
    );
  }

  lineas.push("");

  const fallidos = historial.filter(
    (h) => h.name === "contratos_registrar" && !h.result.ok && /requiere revisi/i.test(h.result.error ?? ""),
  );
  const activo = fallidos.find(
    (p) =>
      !historial.some(
        (h) =>
          h.name === "contratos_registrar" &&
          h.args.mensaje_id === p.args.mensaje_id &&
          h.result.ok,
      ),
  );
  if (activo) {
    const mensajeId = String(activo.args.mensaje_id);
    const extraido = historial.find(
      (h) => h.name === "contratos_extraer" && h.args.mensaje_id === mensajeId,
    );
    const contrato = (extraido?.result.data ?? {}) as Record<string, unknown>;
    lineas.push(`#### ⚠ Requiere tu confirmación: ${mensajeId}`);
    lineas.push("");
    lineas.push(`- **valor**: ${comoTexto(contrato.valor)} (confianza ${confianza(contrato, "valor")})`);
    lineas.push(
      `- **fecha_fin**: ${comoTexto(contrato.fecha_fin)} (confianza ${confianza(contrato, "fecha_fin")})`,
    );
    lineas.push(`- **fecha_inicio**: ${comoTexto(contrato.fecha_inicio)}`);
    lineas.push(`- **estado**: no registrado todavía hasta que confirmes.`);
    lineas.push("");
    lineas.push(
      `> Confirma con un mensaje como: **"confirmo el valor ${numero(contrato.valor)} y la fecha fin ${comoTexto(contrato.fecha_fin)}"**.`,
    );
    lineas.push("");
  }

  const alertas = historial.filter((h) => h.name === "contratos_alertas" && h.result.ok).pop();
  if (alertas) {
    const data = (alertas.result.data ?? {}) as Record<string, unknown>;
    const vencen = (data.vencen as unknown[] | undefined)?.length ?? 0;
    const vencidos = (data.vencidos as unknown[] | undefined)?.length ?? 0;
    const polizas = (data.polizas_pendientes as unknown[] | undefined)?.length ?? 0;
    const nuevos = (data.registrados_desde_corte as unknown[] | undefined)?.length ?? 0;
    lineas.push("#### Alertas generadas en `out/alertas.md`");
    lineas.push("");
    lineas.push(
      `- Vencen en ≤ 60 días: **${vencen}** · Ya vencidos: **${vencidos}** · Pólizas sin estado vigente: **${polizas}** · Registrados después del corte: **${nuevos}**`,
    );
    lineas.push("");
  }

  return lineas.join("\n");
}

function confianza(contrato: Record<string, unknown>, campo: string): string {
  const mapa = contrato.confianza as Record<string, number> | undefined;
  const valor = mapa?.[campo];
  return typeof valor === "number" ? valor.toFixed(2) : "0.00";
}
