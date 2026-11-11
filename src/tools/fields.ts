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

const OUTLINE_MAX_KEYS = 30;
const OUTLINE_MAX_DEPTH = 5;
const OUTLINE_SHORT_STRING = 60;

/**
 * Strukturen i et stort JSON-svar i stedet for innholdet: nøkler, typer og antall elementer, med første element
 * av hver liste som eksempel. Korte verdier vises, så id-er og statuser fortsatt er synlige.
 * Returnerer undefined hvis bodyen ikke er JSON.
 */
export function outline(body: string): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  return shape(json, 0);
}

function shape(value: unknown, depth: number): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") {
    return value.length <= OUTLINE_SHORT_STRING ? JSON.stringify(value) : `<tekst, ${value.length} tegn>`;
  }
  if (depth >= OUTLINE_MAX_DEPTH) return Array.isArray(value) ? `[${value.length} elementer]` : "{…}";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.length} elementer, første: ${shape(value[0], depth + 1)}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const shown = entries.slice(0, OUTLINE_MAX_KEYS).map(([k, v]) => `${k}: ${shape(v, depth + 1)}`);
  if (entries.length > OUTLINE_MAX_KEYS) shown.push(`… ${entries.length - OUTLINE_MAX_KEYS} nøkler til`);
  return `{ ${shown.join(", ")} }`;
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
