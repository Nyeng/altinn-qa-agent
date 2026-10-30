// http_request og inspect_call - agentens "hender" mot API-ene. Sikkerhetsreglene ligger i policy/requests.ts.
// Token og hemmelige headere (API-nøkler) legges på her og vaskes ut av alt som går tilbake til modellen.
import { z } from "zod";
import type { HttpLogEntry, Session } from "../agent/session.js";
import type { Config } from "../config.js";
import { checkRequest, METHODS, resolveUrl } from "../policy/requests.js";
import { defineTool, type Tool, type ToolOutput } from "./define.js";
import { selectFields } from "./fields.js";

const MAX_BODY_CHARS = 8000;
const RESPONSE_EXCERPT_CHARS = 1500;
const TIMEOUT_MS = 30_000;
const SHOWN_HEADERS = ["content-type", "location", "www-authenticate"];

const FIELDS_HELP = "'a.b' felt, 'data.#' antall, 'data[0]'/'data[-1]' første/siste, 'data[*].id' alle id-er.";

export function createHttpTools(config: Config): Tool[] {
  const apiNames = Object.keys(config.apis) as [string, ...string[]];
  const apiList = Object.entries(config.apis)
    .map(([name, api]) => `- ${name}: ${api.description || api.baseUrl.origin}`)
    .join("\n");

  const httpRequest = defineTool({
    name: "http_request",
    description:
      "Send en HTTP-forespørsel til et av API-ene du har tilgang til. `path` er relativ til API-ets base-URL " +
      '(f.eks. /accessmanagement/api/v1/enduser/authorizedparties for "platform"). ' +
      "Kallet gjøres som aktiv testbruker; autentisering og API-nøkler legges på automatisk - ikke send dem selv. " +
      "Bruk `fields` når du vet hva du ser etter - da får du bare de verdiene. Feilsvar (4xx/5xx) returneres alltid " +
      "i sin helhet. Hele svaret lagres; hent mer med inspect_call i stedet for å kalle på nytt.\n\n" +
      `Tilgjengelige API-er:\n${apiList}`,
    input: z.strictObject({
      api: z.enum(apiNames).default("platform").describe('Hvilket API (standard "platform")'),
      method: z.enum(METHODS),
      path: z.string().startsWith("/").describe("Sti relativ til base-URL, må starte med /"),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Ekstra headere, f.eks. Content-Type. Ikke send Authorization."),
      body: z.string().optional().describe("Request-body som tekst (typisk JSON eller XML)"),
      why: z.string().describe("Kort: hva du vil lære av denne forespørselen"),
      fields: z
        .array(z.string())
        .optional()
        .describe(`Valgfritt: bare disse delene av JSON-svaret. ${FIELDS_HELP} Utelat for å se hele svaret.`),
    }),
    label: (i) => `${i.api} ${i.method} ${i.path}${i.fields ? ` [${i.fields.join(", ")}]` : ""}  — ${i.why}`,
    run: (input, session) => sendRequest(input, session),
  });

  const inspectCall = defineTool({
    name: "inspect_call",
    countsAsStep: false,
    description:
      "Hent deler av svaret fra et kall du allerede har gjort (Kall #N), uten å sende forespørselen på nytt. " +
      "`fields` har samme syntaks som i http_request. Utelat fields for å se de første 8000 tegnene.",
    input: z.strictObject({
      call: z.number().int().describe("Kall-ID (#N)"),
      fields: z.array(z.string()).optional(),
    }),
    label: (i) => `🔍 kall #${i.call} [${(i.fields ?? []).join(", ")}]`,
    run: ({ call, fields }, session) => {
      const text = session.responseBodies.get(call);
      if (text === undefined) return { content: `Fant ikke kall #${call}.`, isError: true };
      const selected = fields?.length ? selectFields(text, fields) : undefined;
      return { content: session.redactor.redact(`Kall #${call} (lagret svar):\n${selected ?? truncate(text)}`) };
    },
  });

  return [httpRequest, inspectCall];
}

type HttpInput = {
  api: string;
  method: (typeof METHODS)[number];
  path: string;
  headers?: Record<string, string>;
  body?: string;
  why: string;
  fields?: string[];
};

async function sendRequest(input: HttpInput, session: Session): Promise<ToolOutput> {
  const user = session.users.active;
  if (!user) return { content: "Ingen aktiv bruker. Hent en med pick_test_user først.", isError: true };
  const api = session.config.apis[input.api];
  if (!api) return { content: `Ukjent API "${input.api}".`, isError: true };

  const url = resolveUrl(api.baseUrl, input.path);
  const denied = checkRequest({
    method: input.method,
    url,
    baseUrl: api.baseUrl,
    allowDelete: session.config.allowDelete,
    owned: session.owned,
  });
  if (denied) return { content: denied, isError: true };

  // Modellen får ikke sette auth eller noen av de hemmelige headerne selv.
  const headers = new Headers(input.headers);
  headers.delete("authorization");
  for (const rule of api.headerRules) for (const name of Object.keys(rule.headers)) headers.delete(name);

  // Hemmelige headere for denne stien (f.eks. register- vs. authorization-nøkkel på platform).
  const relativePath = `/${input.path.replace(/^\/+/, "")}`;
  const rules = api.headerRules.filter((r) => relativePath.startsWith(r.pathPrefix));
  const loggedHeaders: Record<string, string> = Object.fromEntries(headers.entries());
  for (const rule of rules) for (const name of Object.keys(rule.headers)) loggedHeaders[name] = `<${rule.secretName}>`;

  const redact = (t: string) => session.redactor.redact(t);
  const id = session.httpLog.length + 1;
  const started = Date.now();
  const log = (status: HttpLogEntry["status"], response: string, contentType?: string) =>
    session.httpLog.push({
      id,
      user: user.alias,
      auth: session.tokens.describe(user),
      api: input.api,
      method: input.method,
      path: input.path,
      url: url.href,
      requestHeaders: loggedHeaders,
      requestBody: input.body && redact(input.body),
      status,
      contentType,
      responseExcerpt: redact(response.slice(0, RESPONSE_EXCERPT_CHARS)),
      why: input.why,
      ms: Date.now() - started,
    });

  let res: Response;
  let text: string;
  try {
    headers.set("authorization", `Bearer ${await session.tokens.tokenFor(user)}`);
    for (const rule of rules) for (const [name, value] of Object.entries(rule.headers)) headers.set(name, value);
    res = await session.fetch(url, {
      method: input.method,
      headers,
      body: input.body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await res.text();
  } catch (err) {
    log("feil", (err as Error).message);
    return { content: redact(`Kall #${id}: nettverksfeil: ${(err as Error).message}`), isError: true };
  }

  log(res.status, text, res.headers.get("content-type") ?? undefined);
  session.responseBodies.set(id, text);
  if (input.method === "POST" && res.ok) session.owned.rememberCreated(input.body, text, res.headers.get("location"));

  // Feilsvar vises alltid i sin helhet: stack traces og lekkasjer skal aldri filtreres bort.
  const selected = input.fields?.length && res.status < 400 ? selectFields(text, input.fields) : undefined;
  const note = input.fields?.length && selected === undefined ? "(fields ignorert: feilsvar eller ikke JSON)\n" : "";
  const shownHeaders = SHOWN_HEADERS.map((h) => [h, res.headers.get(h)] as const)
    .filter(([, v]) => v)
    .map(([h, v]) => `${h}: ${v}`)
    .join("\n");

  return {
    content: redact(
      `Kall #${id}: HTTP ${res.status} ${res.statusText} (${Date.now() - started} ms, ${text.length} tegn)\n` +
        `${shownHeaders}\n\n${note}${selected ?? truncate(text)}`,
    ),
  };
}

function truncate(text: string): string {
  return text.length > MAX_BODY_CHARS
    ? `${text.slice(0, MAX_BODY_CHARS)}\n... [avkortet, ${text.length} tegn totalt - bruk inspect_call/fields for resten]`
    : text;
}
