const MESES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const RE_MES = new RegExp(
  `\\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\\s+de\\s+(\\d{4})\\b`,
  "i",
);

function dosDig(d: number): string {
  return String(d).padStart(2, "0");
}

export function hoyISO(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${dosDig(ahora.getMonth() + 1)}-${dosDig(ahora.getDate())}`;
}

export function esFechaValida(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [a, m, d] = fecha.split("-").map(Number);
  if (!a || !m || !d) return false;
  const objeto = new Date(Date.UTC(a, m - 1, d));
  return (
    objeto.getUTCFullYear() === a &&
    objeto.getUTCMonth() === m - 1 &&
    objeto.getUTCDate() === d
  );
}

export function fechaDeISO(iso: string): string | null {
  const m = iso.match(/\b(\d{4}-\d{2}-\d{2})(?!\d)/);
  if (m && esFechaValida(m[1] ?? "")) return m[1] ?? null;
  return null;
}

export function parseFecha(texto: string): string | null {
  const iso = fechaDeISO(texto);
  if (iso) return iso;
  const coincidencia = RE_MES.exec(texto);
  if (!coincidencia) return null;
  const mes = MESES[(coincidencia[1] ?? "").toLowerCase()];
  const anio = Number(coincidencia[2]);
  if (!mes || !anio) return null;
  const previo = texto.slice(Math.max(0, coincidencia.index - 50), coincidencia.index);
  const numeros = [...previo.matchAll(/(\d{1,2})(?!\d)/g)]
    .map((n) => Number(n[1]))
    .filter((n) => n >= 1 && n <= 31);
  if (numeros.length === 0) return null;
  const dia = numeros[numeros.length - 1] ?? 0;
  const fecha = `${anio}-${dosDig(mes)}-${dosDig(dia)}`;
  return esFechaValida(fecha) ? fecha : null;
}

export function anioMes(texto: string): { anio: number; mes: number } | null {
  const coincidencia = RE_MES.exec(texto);
  if (!coincidencia) return null;
  const mes = MESES[(coincidencia[1] ?? "").toLowerCase()];
  const anio = Number(coincidencia[2]);
  if (!mes || !anio) return null;
  return { anio, mes };
}

export function addMonths(fecha: string, meses: number): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  if (!anio || !mes || !dia) return fecha;
  const total = anio * 12 + (mes - 1) + meses;
  const nuevoAnio = Math.floor(total / 12);
  const nuevoMes = (total % 12) + 1;
  const ultimoDia = new Date(Date.UTC(nuevoAnio, nuevoMes, 0)).getUTCDate();
  return `${nuevoAnio}-${dosDig(nuevoMes)}-${dosDig(Math.min(dia, ultimoDia))}`;
}

function desplazar(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  if (!a || !m || !d) return fecha;
  const objeto = new Date(Date.UTC(a, m - 1, d));
  objeto.setUTCDate(objeto.getUTCDate() + dias);
  return `${objeto.getUTCFullYear()}-${dosDig(objeto.getUTCMonth() + 1)}-${dosDig(objeto.getUTCDate())}`;
}

export function menosUnDia(fecha: string): string {
  return desplazar(fecha, -1);
}

export function sumaDias(fecha: string, dias: number): string {
  return desplazar(fecha, dias);
}

export function diasEntre(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  if (!a1 || !m1 || !d1 || !a2 || !m2 || !d2) return 0;
  const t1 = Date.UTC(a1, m1 - 1, d1);
  const t2 = Date.UTC(a2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86400000);
}

export function maxFecha(a: string, b: string): string {
  return diasEntre(a, b) >= 0 ? b : a;
}
