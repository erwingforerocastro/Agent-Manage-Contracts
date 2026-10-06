export type Fila = Record<string, string>;

function parsearLinea(linea: string, delimitador: string): string[] {
  const campos: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea.charAt(i);
    if (entreComillas) {
      if (c === '"') {
        if (linea.charAt(i + 1) === '"') {
          actual += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        actual += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === delimitador) {
      campos.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos;
}

export function parseCsv(texto: string, delimitador = ","): { columnas: string[]; filas: Fila[] } {
  const limpio = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const lineas = limpio.split("\n").filter((l) => l.trim() !== "");
  const columnas = parsearLinea(lineas[0] ?? "", delimitador);
  const filas: Fila[] = [];
  for (const linea of lineas.slice(1)) {
    const campos = parsearLinea(linea, delimitador);
    const fila: Fila = {};
    columnas.forEach((columna, i) => {
      fila[columna] = campos[i] ?? "";
    });
    filas.push(fila);
  }
  return { columnas, filas };
}

function escapar(valor: unknown, delimitador: string): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  const necesita =
    texto.includes(delimitador) || texto.includes('"') || texto.includes("\n") || texto.includes("\r");
  if (!necesita) return texto;
  return `"${texto.replace(/"/g, '""')}"`;
}

export function aCsv(columnas: string[], filas: Fila[], delimitador = ","): string {
  const encabezado = columnas.map((c) => escapar(c, delimitador)).join(delimitador);
  const cuerpo = filas.map((fila) =>
    columnas.map((c) => escapar(fila[c] ?? "", delimitador)).join(delimitador),
  );
  return [encabezado, ...cuerpo].join("\n") + "\n";
}

export function aBool(valor: string): boolean {
  return valor.trim().toLowerCase() === "true";
}

export function aNumero(valor: string): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}
