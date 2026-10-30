// Kunnskap fra Altinn/altinn-platform-validation-tests (PVT), lest direkte fra GitHub - ingenting kopieres hit.
//   - API-referanse: K6-klientene (K6/clients/**) beskriver hvert endepunkt med metode, sti, parametre og
//     hvilket token som trengs (JSDoc). Oppsummeres kompakt, så modellen slipper å lese hele koden.
//   - Scopes: K6/scopes.js er listen over Altinn-scopes teamet bruker. Tjenesteeier-tokens begrenses til disse.
// PVT er kilden for alle Altinn-produkter (access management, dialogporten, correspondence, storage ...).

const REPO = "Altinn/altinn-platform-validation-tests";
const RAW = `https://raw.githubusercontent.com/${REPO}/refs/heads/main`;
const TREE = `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`;
const CLIENTS_DIR = "K6/clients/";
const MAX_CLIENTS_SUMMARIZED = 3;
const MAX_MATCHES_LISTED = 15;

// Scopes som aldri gis: admin-tilgang, deploy, og utsending av varsler (sender ekte e-post/SMS).
const DENIED_SCOPE = /\.admin\b|appdeploy|notifications\.create/;

export class PvtKnowledge {
  private clientPaths?: Promise<string[]>;
  private readonly summaries = new Map<string, Promise<string>>();

  constructor(private readonly opts: { fetch?: typeof fetch; githubToken?: string } = {}) {}

  /** Alle K6-klienter i PVT, som områder: "access-management/enduser/request/request". */
  async areas(): Promise<string[]> {
    this.clientPaths ??= this.get(TREE, true).then((text) => {
      const tree = JSON.parse(text) as { tree: { path: string; type: string }[] };
      return tree.tree
        .filter((t) => t.type === "blob" && t.path.startsWith(CLIENTS_DIR) && t.path.endsWith(".js"))
        .map((t) => t.path.slice(CLIENTS_DIR.length, -".js".length))
        .filter((p) => !/(^|\/)(index|types|[^/]*\.types)$/.test(p) && !p.startsWith("common/"));
    });
    return this.clientPaths;
  }

  /** Oppslag på område eller stikkord ("request", "dialogporten serviceowner", "correspondence"). */
  async reference(query: string): Promise<string> {
    const words = query
      .toLowerCase()
      .split(/[\s/,]+/)
      .filter(Boolean);
    const areas = await this.areas();
    const matches = areas
      .map((a) => ({ a, score: words.filter((w) => a.toLowerCase().includes(w)).length }))
      .filter((m) => m.score > 0)
      .sort((x, y) => y.score - x.score || x.a.length - y.a.length)
      .map((m) => m.a);
    if (matches.length === 0) {
      const products = [...new Set(areas.map((a) => a.split("/")[0]))].join(", ");
      return `Ingen PVT-klient matcher "${query}". Produkter: ${products}`;
    }
    const summaries = await Promise.all(matches.slice(0, MAX_CLIENTS_SUMMARIZED).map((a) => this.summary(a)));
    // Oppslag på policy gir også modellen for å lage en policy, ikke bare endepunktene.
    if (words.some((w) => /^(policy|policyer|xacml)$/.test(w))) summaries.push(await this.policyModel());
    const rest = matches.slice(MAX_CLIENTS_SUMMARIZED, MAX_MATCHES_LISTED);
    return [
      ...summaries,
      rest.length ? `Andre treff (slå opp mer presist): ${rest.join(", ")}` : "",
      `Kilde: ${REPO} (K6/clients)`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /**
   * Policy-modellen K6 bruker for nye testressurser: XacmlPolicyBuilder (bygger XACML med roller, tilgangspakker og
   * actions) og hvordan K6-testen kaller den. En ny ressurs uten policy gir Indeterminate fra PDP.
   */
  async policyModel(): Promise<string> {
    const builders = await this.get(`${RAW}/K6/clients/resource-registry/resource.builders.js`);
    const start = builders.indexOf("class XacmlPolicyBuilder");
    const next = builders.slice(start + 1).search(/\n(class |export )/);
    const builder =
      start < 0 ? "(fant ikke XacmlPolicyBuilder)" : builders.slice(start, next < 0 ? undefined : start + 1 + next);
    const test = await this.get(`${RAW}/K6/api/tests/resource-registry/create-resource-and-policy.js`);
    const use = test.indexOf("new XacmlPolicyBuilder");
    const usage = use < 0 ? "" : test.slice(use, test.indexOf(".build()", use) + ".build()".length);
    return [
      "Policy-modell for nye testressurser (fra K6/clients/resource-registry/resource.builders.js):",
      "```js",
      builder.slice(0, 7000),
      "```",
      usage &&
        `Slik bruker K6 den (create-resource-and-policy.js), før ResourceCreatePolicy laster opp filen:\n\`\`\`js\n${usage}\n\`\`\``,
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** Scopes fra PVT som kan brukes i tjenesteeier-tokens (uten admin, deploy og varselutsending). */
  async allowedScopes(): Promise<string[]> {
    const text = await this.get(`${RAW}/K6/scopes.js`);
    // Noen strenger i scopes.js er ferdige lister med flere scopes adskilt av mellomrom.
    const scopes = [...text.matchAll(/["']((?:altinn|digdir):[^"']+)["']/g)].flatMap((m) => m[1].split(/\s+/));
    return [...new Set(scopes)].filter((s) => !DENIED_SCOPE.test(s)).sort();
  }

  private summary(area: string): Promise<string> {
    let s = this.summaries.get(area);
    if (!s) {
      s = this.get(`${RAW}/${CLIENTS_DIR}${area}.js`).then((code) => summarizeClient(area, code));
      this.summaries.set(area, s);
    }
    return s;
  }

  private async get(url: string, api = false): Promise<string> {
    const headers: Record<string, string> = {};
    if (api && this.opts.githubToken) headers.authorization = `Bearer ${this.opts.githubToken}`;
    const res = await (this.opts.fetch ?? fetch)(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Klarte ikke hente ${url} (${res.status})`);
    return res.text();
  }
}

/** Kompakt oppsummering av én K6-klient: én linje per metode med HTTP-metode, sti, parametre og beskrivelse. */
export function summarizeClient(area: string, code: string): string {
  const basePath = code.match(/BASE_PATH\s*=\s*["'`]([^"'`]+)["'`]/)?.[1] ?? "";
  const lines = [`### ${area}${basePath ? `  (${basePath})` : ""}`];
  const tokenNote = code.match(/Needs? (?:an? )?([^.\n]*token[^.\n]*)/i)?.[1];
  if (tokenNote) lines.push(`Token: ${tokenNote.trim()}`);

  // JSDoc-blokk etterfulgt av en metodedefinisjon i klassen.
  // JSDoc-innholdet kan ikke krysse en "*/", ellers slukes konstruktøren inn i første metodes beskrivelse.
  const methodRe =
    /\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*\n\s{4}(?:async\s+)?([A-Z][A-Za-z0-9]*)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\s{4}\}/g;
  for (const [, doc, name, params, body] of code.matchAll(methodRe)) {
    const call = body.match(/http\.(get|post|put|patch|del|request)\s*\(/);
    if (!call) continue;
    const verb = call[1] === "del" ? "DELETE" : call[1].toUpperCase();
    const path = pathOf(body.slice((call.index ?? 0) + call[0].length), basePath);
    const description = doc
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter((l) => l && !l.startsWith("@"))
      .join(" ")
      .split(/(?<=\.)\s/)[0]
      .replace(/^https?:\/\/\S+$/, ""); // rene swagger-lenker gir ingen beskrivelse
    const args = params
      .split(",")
      .map((p) => p.trim().split("=")[0].trim())
      .filter((p) => p && p !== "labels");
    lines.push(`- ${name}(${args.join(", ")}) → ${verb} ${path}${description ? ` — ${description}` : ""}`);
  }
  return lines.join("\n");
}

// Gjør om første argument til http.x(...) til en lesbar sti: "/base/received?party&id".
function pathOf(rest: string, basePath: string): string {
  let expr = rest.trimStart();
  let query = "";
  const viaBuildUrl = expr.startsWith("buildUrl(");
  if (viaBuildUrl) expr = expr.slice("buildUrl(".length);
  const first = firstArgument(expr);
  if (viaBuildUrl) {
    const second = firstArgument(expr.slice(first.length + 1));
    // { party, to, package: packageId } → party, to, package (nøkkelen, ikke variabelnavnet)
    const keys = firstArgument(second.trim().replace(/^\{/, ""))
      ? second
          .trim()
          .replace(/^\{|\}$/g, "")
          .split(",")
          .map((entry) => entry.split(":")[0].trim())
          .filter((k) => /^[A-Za-z_]\w*$/.test(k))
      : [];
    if (second.trim().startsWith("{") && keys.length) query = `?${keys.join("&")}`;
    else if (second.trim() && second.trim() !== "null") query = `?{${second.trim()}}`;
  }
  const path = first
    .replace(/\$\{this\.FULL_PATH\}|this\.FULL_PATH/g, basePath)
    .replace(/\$\{([^}]+)\}/g, "{$1}")
    .replace(/["'`+\s]/g, "");
  return `${path || basePath}${query}`;
}

function firstArgument(text: string): string {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) {
      if (depth === 0) return text.slice(0, i);
      depth--;
    } else if (c === "," && depth === 0) return text.slice(0, i);
  }
  return text;
}
