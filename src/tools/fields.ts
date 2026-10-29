// Plukker ut deler av et JSON-svar, så modellen slipper å lese hele bodyen.
//   a.b.c        felt
//   data.#       antall elementer i en liste (eller nøkler i et objekt)
//   data[0]      første element, data[-1] siste
//   data[*].id   alle id-ene i lista
// Ukjente stier gir "(finnes ikke)" i stedet for feil, så modellen ser hva som mangler.

const MAX_VALUE_CHARS = 1500;
const MISSING = Symbol("finnes ikke");

type Token = { key: string } | { index: number } | { all: true } | { count: true };

function tokenize(path: string): Token[] {
  const tokens: Token[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[(-?\d+|\*)\]/g)) {
    if (m[1] === "#") tokens.push({ count: true });
    else if (m[1] !== undefined) tokens.push({ key: m[1] });
    else if (m[2] === "*") tokens.push({ all: true });
    else tokens.push({ index: Number(m[2]) });
  }
  return tokens;
}

function walk(value: unknown, tokens: Token[]): unknown {
  if (tokens.length === 0) return value;
  const [t, ...rest] = tokens;
  if (value === MISSING || value === null || value === undefined) return MISSING;
  if ("count" in t) {
    if (Array.isArray(value)) return value.length;
    if (typeof value === "object") return Object.keys(value as object).length;
    return MISSING;
  }
  if ("all" in t) return Array.isArray(value) ? value.map((v) => walk(v, rest)) : MISSING;
  if ("index" in t) {
    if (!Array.isArray(value)) return MISSING;
    const i = t.index < 0 ? value.length + t.index : t.index;
    return i >= 0 && i < value.length ? walk(value[i], rest) : MISSING;
  }
  if (typeof value !== "object" || !(t.key in (value as object))) return MISSING;
  return walk((value as Record<string, unknown>)[t.key], rest);
}

function format(value: unknown): string {
  if (value === MISSING) return "(finnes ikke)";
  if (Array.isArray(value) && value.some((v) => v === MISSING)) {
    value = value.map((v) => (v === MISSING ? "(finnes ikke)" : v));
  }
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}… [${text.length} tegn]` : text;
}

/** Returnerer én linje per sti, eller undefined hvis bodyen ikke er JSON. */
export function selectFields(body: string, paths: string[]): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  return paths.map((p) => `${p} = ${format(walk(json, tokenize(p)))}`).join("\n");
}
