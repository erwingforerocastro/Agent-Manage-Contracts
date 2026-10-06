const $ = (sel) => document.querySelector(sel);
const mensajes = $("#mensajes");
const texto = $("#texto");
const formulario = $("#formulario");
const enviar = $("#enviar");
const pendienteDiv = $("#pendiente");

let ocupado = false;
let ultimaRespuesta = null;

const sesionInput = $("#sesion");
sesionInput.value = localStorage.getItem("contratos_sesion") || "web";
const hoyInput = $("#hoy");
hoyInput.value = new Date().toISOString().slice(0, 10);

function esc(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(texto) {
  return esc(texto)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

function md(tabla) {
  const lineas = String(tabla ?? "").split("\n");
  const salida = [];
  let lista = null;
  let i = 0;
  const cerrarLista = () => {
    if (lista) {
      salida.push(lista === "ul" ? "</ul>" : "</ol>");
      lista = null;
    }
  };
  while (i < lineas.length) {
    const linea = lineas[i];
    if (/^\s*$/.test(linea)) {
      cerrarLista();
      i++;
      continue;
    }
    if (linea.startsWith("|") && i + 1 < lineas.length && /^\s*\|[\s:|-]+\|\s*$/.test(lineas[i + 1])) {
      cerrarLista();
      const filas = [];
      while (i < lineas.length && lineas[i].trim().startsWith("|")) {
        filas.push(lineas[i]);
        i++;
      }
      const celdas = (f) => f.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      salida.push("<table><thead><tr>");
      for (const c of celdas(filas[0])) salida.push(`<th>${inline(c)}</th>`);
      salida.push("</tr></thead><tbody>");
      for (const fila of filas.slice(2)) {
        salida.push("<tr>");
        for (const c of celdas(fila)) salida.push(`<td>${inline(c)}</td>`);
        salida.push("</tr>");
      }
      salida.push("</tbody></table>");
      continue;
    }
    const encabezado = linea.match(/^(#{1,4})\s+(.*)$/);
    if (encabezado) {
      cerrarLista();
      const nivel = Math.min(4, encabezado[1].length + 2);
      salida.push(`<h${nivel}>${inline(encabezado[2])}</h${nivel}>`);
      i++;
      continue;
    }
    if (/^>\s?/.test(linea)) {
      cerrarLista();
      const cuerpo = [linea.replace(/^>\s?/, "")];
      i++;
      while (i < lineas.length && /^>\s?/.test(lineas[i])) {
        cuerpo.push(lineas[i].replace(/^>\s?/, ""));
        i++;
      }
      salida.push(`<blockquote>${inline(cuerpo.join(" "))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(linea)) {
      if (lista !== "ul") {
        cerrarLista();
        salida.push("<ul>");
        lista = "ul";
      }
      salida.push(`<li>${inline(linea.replace(/^\s*[-*]\s+/, ""))}</li>`);
      i++;
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(linea)) {
      if (lista !== "ol") {
        cerrarLista();
        salida.push("<ol>");
        lista = "ol";
      }
      salida.push(`<li>${inline(linea.replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
      i++;
      continue;
    }
    cerrarLista();
    const parrafo = [linea];
    i++;
    while (i < lineas.length && lineas[i].trim() !== "" && !/^(#{1,4}\s|>|[-*]\s|\d+[.)]\s|\|)/.test(lineas[i])) {
      parrafo.push(lineas[i]);
      i++;
    }
    salida.push(`<p>${inline(parrafo.join(" "))}</p>`);
  }
  cerrarLista();
  return salida.join("");
}

function nuevaBurbuja(clase) {
  const div = document.createElement("div");
  div.className = `msg ${clase}`;
  const contenido = document.createElement("div");
  contenido.className = "contenido";
  div.appendChild(contenido);
  mensajes.appendChild(div);
  mensajes.scrollTop = mensajes.scrollHeight;
  return contenido;
}

function pintarHerramientas(contenedor, llamadas) {
  if (!llamadas || llamadas.length === 0) return;
  const caja = document.createElement("div");
  caja.className = "herramientas";
  for (const llamada of llamadas) {
    const item = document.createElement("div");
    item.className = `herramienta${llamada.ok ? "" : " falla"}`;
    item.innerHTML = `<b>${esc(llamada.nombre)}</b> · ${llamada.ok ? "ok" : "error"} <span>▾</span>`;
    const detalle = document.createElement("pre");
    let args = "";
    try {
      args = JSON.stringify(llamada.args ?? {}, null, 2);
    } catch {
      args = String(llamada.args);
    }
    let resultado = llamada.resultado;
    try {
      resultado = JSON.stringify(JSON.parse(llamada.resultado), null, 2);
    } catch {
      /* se queda crudo */
    }
    detalle.textContent = `${args}\n\n→ ${resultado}`;
    item.appendChild(detalle);
    item.addEventListener("click", () => item.classList.toggle("abierta"));
    caja.appendChild(item);
  }
  contenedor.appendChild(caja);
  mensajes.scrollTop = mensajes.scrollHeight;
}

function mostrarPendientes(lista) {
  const pendientes = Array.isArray(lista) ? lista : lista ? [lista] : [];
  if (pendientes.length === 0) {
    pendienteDiv.hidden = true;
    pendienteDiv.textContent = "";
    return;
  }
  pendienteDiv.hidden = false;
  pendienteDiv.textContent = pendientes
    .map((p) => `⚠ ${p.mensaje_id}: esperando confirmación de ${p.campos.join(", ")}`)
    .join(" | ");
}

async function enviarMensaje(mensaje) {
  if (ocupado || !mensaje.trim()) return;
  ocupado = true;
  enviar.disabled = true;
  const burbujaUsuario = nuevaBurbuja("usuario");
  burbujaUsuario.textContent = mensaje;
  texto.value = "";
  const burbujaAsistente = nuevaBurbuja("asistente");
  burbujaAsistente.innerHTML = "<span class='vacio'>Pensando…</span>";

  try {
    const respuesta = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sesionInput.value.trim() || "web",
        message: mensaje,
        hoy: hoyInput.value || undefined,
      }),
    });
    const datos = await respuesta.json();
    if (datos.error && !datos.reply) throw new Error(datos.error);
    burbujaAsistente.innerHTML = md(datos.reply || "(sin respuesta)");
    pintarHerramientas(burbujaAsistente, datos.toolCalls);
    if (datos.needsConfirmation) await refrescarPendientes();
    else mostrarPendientes(null);
    localStorage.setItem("contratos_sesion", sesionInput.value.trim() || "web");
  } catch (e) {
    burbujaAsistente.innerHTML = `<p><strong>Error:</strong> ${inline(e.message)}</p>`;
  } finally {
    ocupado = false;
    enviar.disabled = false;
    refrescarLateral();
    texto.focus();
  }
}

formulario.addEventListener("submit", (e) => {
  e.preventDefault();
  enviarMensaje(texto.value);
});

texto.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    enviarMensaje(texto.value);
  }
});

async function json(url) {
  const r = await fetch(url);
  return r.json();
}

async function refrescarPendientes() {
  try {
    const datos = await json(`/api/sessions/${encodeURIComponent(sesionInput.value.trim() || "web")}`);
    mostrarPendientes(datos.pendientes);
  } catch {
    mostrarPendientes(null);
  }
}

function pintarMaestro(filas, procesados) {
  const vista = $("#vista-maestro");
  if (!filas || filas.length === 0) {
    vista.innerHTML = "<p class='vacio'>El maestro está vacío.</p>";
    return;
  }
  const columnas = [
    "id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda",
    "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza", "estado_poliza",
    "comercial", "fecha_registro",
  ];
  const partes = [];
  partes.push(
    `<p class="vacio">${filas.length} contrato(s) · ${procesados.length} mensaje(s) procesado(s)</p>`,
  );
  partes.push('<table class="tabla"><thead><tr>');
  for (const c of columnas) partes.push(`<th>${esc(c)}</th>`);
  partes.push("</tr></thead><tbody>");
  for (const fila of filas) {
    partes.push("<tr>");
    for (const c of columnas) {
      const valor = fila[c];
      partes.push(`<td>${esc(typeof valor === "boolean" ? (valor ? "true" : "false") : valor)}</td>`);
    }
    partes.push("</tr>");
  }
  partes.push("</tbody></table>");
  vista.innerHTML = partes.join("");
}

function pintarBitacora(log) {
  const vista = $("#vista-bitacora");
  if (!log || log.length === 0) {
    vista.innerHTML = "<p class='vacio'>Sin ejecuciones todavía.</p>";
    return;
  }
  const lineas = log
    .slice()
    .reverse()
    .map((e) => `${String(e.ts).slice(11, 19)}  ${e.ok ? "ok " : "ERR"}  ${e.herramienta}${e.mensaje_id ? ` [${e.mensaje_id}]` : ""}  ${e.resumen}`);
  vista.innerHTML = `<pre class="markdown-claro">${esc(lineas.join("\n"))}</pre>`;
}

function pintarHerramientasSesion(llamadas) {
  const vista = $("#vista-herramientas");
  if (!llamadas || llamadas.length === 0) {
    vista.innerHTML = "<p class='vacio'>Sin llamadas todavía.</p>";
    return;
  }
  const lineas = llamadas
    .slice()
    .reverse()
    .map((l) => {
      const resumen = String(l.resultado).slice(0, 160).replace(/\n/g, " ");
      return `${String(l.ts).slice(11, 19)}  iter ${l.iteracion}  ${l.nombre}  ${l.ok ? "ok" : "ERR"}\n     args: ${JSON.stringify(l.args).slice(0, 200)}\n     → ${resumen}`;
    });
  vista.innerHTML = `<pre class="markdown-claro">${esc(lineas.join("\n\n"))}</pre>`;
}

async function refrescarLateral() {
  try {
    const estado = await json("/api/estado");
    pintarMaestro(estado.maestro, estado.procesados);
    pintarBitacora(estado.log);
    if (estado.adaptador) {
      $("#estado-adaptador").textContent = `${estado.adaptador.proveedor} · ${estado.adaptador.modelo}`;
    }
    const alertas = await json("/api/alertas");
    $("#vista-alertas").innerHTML = alertas.texto
      ? `<pre class="markdown-claro">${esc(alertas.texto)}</pre>`
      : "<p class='vacio'>Aún no hay alertas.</p>";
    const sesion = await json(`/api/sessions/${encodeURIComponent(sesionInput.value.trim() || "web")}`);
    pintarHerramientasSesion(sesion.llamadas);
    mostrarPendientes(sesion.pendientes);
  } catch (e) {
    console.error(e);
  }
}

document.querySelectorAll(".pestana").forEach((boton) => {
  boton.addEventListener("click", () => {
    document.querySelectorAll(".pestana").forEach((b) => b.classList.remove("activa"));
    document.querySelectorAll(".vista").forEach((v) => v.classList.remove("activa"));
    boton.classList.add("activa");
    $(`#vista-${boton.dataset.vista}`).classList.add("activa");
  });
});

sesionInput.addEventListener("change", () => refrescarPendientes());

refrescarLateral();
