const PREPOSICIONES = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "en",
  "con",
  "para",
  "por",
]);

const SUFIJOS: Record<string, string> = {
  "s.a.s": "S.A.S.",
  "sas": "S.A.S.",
  "s.a": "S.A.",
  sa: "S.A.",
  "s.a.c": "S.A.C.",
  sac: "S.A.C.",
  "s.": "S.",
  "r.l": "R.L.",
  rl: "R.L.",
  "s. de r.l": "S. de R.L.",
  ltda: "Ltda.",
  "ltda.": "Ltda.",
};

export function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizar(texto: string): string {
  return sinAcentos(texto)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function titulo(texto: string): string {
  const palabras = texto.trim().split(/\s+/);
  return palabras
    .map((palabra, i) => {
      const clave = palabra.toLowerCase().replace(/[.,;:]$/, "").trim();
      const exacta = palabra.toLowerCase();
      if (SUFIJOS[clave]) return SUFIJOS[clave];
      if (SUFIJOS[exacta]) return SUFIJOS[exacta];
      if (i > 0 && PREPOSICIONES.has(clave)) return clave;
      const minus = palabra.toLowerCase();
      return minus.charAt(0).toUpperCase() + minus.slice(1);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slug(texto: string): string {
  const limpio = normalizar(
    texto.replace(
      /\b(s\.?\s*a\.?\s*s\.?|s\.?\s*a\.?\s*c\.?|s\.?\s*a\.?|s\.?\s*de\s*r\.?\s*l\.?|ltda\.?|s\.?\s*de\s*c\.?)\b/gi,
      " ",
    ),
  );
  return limpio.replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function levenshtein(a: string, b: string): number {
  const filas = a.length + 1;
  const columnas = b.length + 1;
  let anterior = Array.from({ length: columnas }, (_, i) => i);
  for (let i = 1; i < filas; i++) {
    const actual = [i, ...Array.from({ length: columnas - 1 }, () => 0)];
    for (let j = 1; j < columnas; j++) {
      const costo = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      actual[j] = Math.min(
        (actual[j - 1] ?? 0) + 1,
        (anterior[j] ?? 0) + 1,
        (anterior[j - 1] ?? 0) + costo,
      );
    }
    anterior = actual;
  }
  return anterior[columnas - 1] ?? 0;
}

export function similitud(a: string, b: string): number {
  const x = normalizar(a);
  const y = normalizar(b);
  if (x === y) return 1;
  const largo = Math.max(x.length, y.length);
  if (largo === 0) return 1;
  return 1 - levenshtein(x, y) / largo;
}

export function parseNumero(texto: string): number | null {
  const limpio = texto.replace(/[^\d.,]/g, "");
  if (limpio === "") return null;
  let normalizado = limpio;
  const tienePunto = limpio.includes(".");
  const tieneComa = limpio.includes(",");
  if (tienePunto && tieneComa) {
    const ultimoPunto = limpio.lastIndexOf(".");
    const ultimaComa = limpio.lastIndexOf(",");
    normalizado =
      ultimaComa > ultimoPunto
        ? limpio.replace(/\./g, "").replace(",", ".")
        : limpio.replace(/,/g, "");
  } else if (tienePunto) {
    const esMiles = /^\d{1,3}(\.\d{3})+$/.test(limpio);
    normalizado = esMiles ? limpio.replace(/\./g, "") : limpio;
  } else if (tieneComa) {
    const esMiles = /^\d{1,3}(,\d{3})+$/.test(limpio);
    normalizado = esMiles ? limpio.replace(/,/g, "") : limpio.replace(",", ".");
  }
  const valor = Number(normalizado);
  return Number.isFinite(valor) ? valor : null;
}

export function limpiarIdentificador(texto: string): string | null {
  const sinPuntos = texto.replace(/\./g, "").trim();
  const base = sinPuntos.includes("-") ? sinPuntos.split("-")[0] ?? "" : sinPuntos;
  const digitos = base.replace(/\D/g, "");
  if (digitos.length < 5) return null;
  return digitos;
}

export function recortar(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length <= max) return limpio;
  const cortado = limpio.slice(0, max);
  const espacio = cortado.lastIndexOf(" ");
  return (espacio > max * 0.6 ? cortado.slice(0, espacio) : cortado).trim();
}
