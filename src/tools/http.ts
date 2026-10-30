// http_request, http_burst og inspect_call - agentens "hender" mot API-ene. Sikkerhetsreglene ligger i policy/requests.ts.
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

  const httpBurst = defineTool({
    name: "http_burst",
    description:
      "Send SAMME forespørsel N ganger samtidig (2-10) - for race conditions, samtidighet, idempotens og " +
      "dobbeltinnsending (f.eks. to like delegeringer på en gang). Samme regler, autentisering og nøkler som " +
      "http_request. Svaret viser statusfordelingen og hvert kall (#ID), så du kan sjekke: ingen 500, riktig " +
      "antall opprettet (verifiser med GET etterpå), og at taperne får et ryddig svar. Bruk bare når samtidighet " +
      "er det som testes.",
    input: z.strictObject({
      api: z.enum(apiNames).default("platform"),
      method: z.enum(METHODS),
      path: z.string().startsWith("/"),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.string().optional(),
      count: z.number().int().describe("Antall samtidige kall, 2-10"),
      why: z.string(),
      fields: z.array(z.string()).optional(),
    }),
    label: (i) => `⚡ ${i.count}× ${i.api} ${i.method} ${i.path}  — ${i.why}`,
    run: (input, session) => {
      if (input.count < 2 || input.count > 10) return { content: "count må være mellom 2 og 10.", isError: true };
      return sendBurst(input, session);
    },
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

  return [httpRequest, httpBurst, inspectCall];
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

type Prepared = {
  user: NonNullable<Session["users"]["active"]>;
  url: URL;
  headers: Headers;
  rules: Config["apis"][string]["headerRules"];
  loggedHeaders: Record<string, string>;
};

type Sent = { id: number; ms: number; res?: Response; text: string; error?: string };

/** Sikkerhetssjekk og headere - felles for http_request og http_burst. Returnerer feilmelding hvis ikke lov. */
function prepare(input: HttpInput, session: Session): Prepared | string {
  const user = session.users.active;
  if (!user) return "Ingen aktiv bruker. Hent en med pick_test_user først.";
  const api = session.config.apis[input.api];
  if (!api) return `Ukjent API "${input.api}".`;

  const url = resolveUrl(api.baseUrl, input.path);
  const denied = checkRequest({
    method: input.method,
    url,
    baseUrl: api.baseUrl,
    allowDelete: session.config.allowDelete,
    owned: session.owned,
  });
  if (denied) return denied;

  // Modellen får ikke sette auth eller noen av de hemmelige headerne selv.
  const headers = new Headers(input.headers);
  headers.delete("authorization");
  for (const rule of api.headerRules) for (const name of Object.keys(rule.headers)) headers.delete(name);

  // Hemmelige headere for denne stien (f.eks. register- vs. authorization-nøkkel på platform).
  const relativePath = `/${input.path.replace(/^\/+/, "")}`;
  const rules = api.headerRules.filter((r) => relativePath.startsWith(r.pathPrefix));
  const loggedHeaders: Record<string, string> = Object.fromEntries(headers.entries());
  for (const rule of rules) for (const name of Object.keys(rule.headers)) loggedHeaders[name] = `<${rule.secretName}>`;
  return { user, url, headers, rules, loggedHeaders };
}

/** Sender ett kall, logger det (renset) og lagrer svaret for inspect_call. */
async function send(input: HttpInput, prep: Prepared, session: Session): Promise<Sent> {
  const redact = (t: string) => session.redactor.redact(t);
  const id = session.nextCallId();
  const started = Date.now();
  const log = (status: HttpLogEntry["status"], response: string, contentType?: string) =>
    session.httpLog.push({
      id,
      user: prep.user.alias,
      auth: session.tokens.describe(prep.user),
      api: input.api,
      method: input.method,
      path: input.path,
      url: prep.url.href,
      requestHeaders: prep.loggedHeaders,
      requestBody: input.body && redact(input.body),
      status,
      contentType,
      responseExcerpt: redact(response.slice(0, RESPONSE_EXCERPT_CHARS)),
      why: input.why,
      ms: Date.now() - started,
    });

  try {
    const headers = new Headers(prep.headers);
    headers.set("authorization", `Bearer ${await session.tokens.tokenFor(prep.user)}`);
    for (const rule of prep.rules) for (const [name, value] of Object.entries(rule.headers)) headers.set(name, value);
    const res = await session.fetch(prep.url, {
      method: input.method,
      headers,
      body: input.body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    log(res.status, text, res.headers.get("content-type") ?? undefined);
    session.responseBodies.set(id, text);
    if (input.method === "POST" && res.ok) session.owned.rememberCreated(input.body, text, res.headers.get("location"));
    return { id, ms: Date.now() - started, res, text };
  } catch (err) {
    log("feil", (err as Error).message);
    return { id, ms: Date.now() - started, text: "", error: (err as Error).message };
  }
}

/** Svaret slik modellen ser det. Feilsvar vises alltid i sin helhet: stack traces og lekkasjer skal aldri filtreres bort. */
function describe(sent: Sent, fields: string[] | undefined, maxChars = MAX_BODY_CHARS): string {
  if (!sent.res) return `Kall #${sent.id}: nettverksfeil: ${sent.error}`;
  const { res, text } = sent;
  const selected = fields?.length && res.status < 400 ? selectFields(text, fields) : undefined;
  const note = fields?.length && selected === undefined ? "(fields ignorert: feilsvar eller ikke JSON)\n" : "";
  const shownHeaders = SHOWN_HEADERS.map((h) => [h, res.headers.get(h)] as const)
    .filter(([, v]) => v)
    .map(([h, v]) => `${h}: ${v}`)
    .join("\n");
  const body = selected ?? (text.length > maxChars ? truncate(text, maxChars) : text);
  return `Kall #${sent.id}: HTTP ${res.status} ${res.statusText} (${sent.ms} ms, ${text.length} tegn)\n${shownHeaders}\n\n${note}${body}`;
}

async function sendRequest(input: HttpInput, session: Session): Promise<ToolOutput> {
  const prep = prepare(input, session);
  if (typeof prep === "string") return { content: prep, isError: true };
  const sent = await send(input, prep, session);
  return { content: session.redactor.redact(describe(sent, input.fields)), isError: sent.res ? undefined : true };
}

const BURST_BODY_CHARS = 1500;

/** Samme forespørsel N ganger samtidig - for race conditions, samtidighet og idempotens. */
async function sendBurst(input: HttpInput & { count: number }, session: Session): Promise<ToolOutput> {
  const prep = prepare(input, session);
  if (typeof prep === "string") return { content: prep, isError: true };
  // Token hentes før kappløpet, så alle kallene starter så likt som mulig.
  await session.tokens.tokenFor(prep.user);
  const all = await Promise.all(Array.from({ length: input.count }, () => send(input, prep, session)));
  const byStatus = new Map<string, number[]>();
  for (const s of all) {
    const key = s.res ? String(s.res.status) : "nettverksfeil";
    byStatus.set(key, [...(byStatus.get(key) ?? []), s.id]);
  }
  const distinctBodies = new Set(all.map((s) => s.text)).size;
  const summary =
    `${input.count} samtidige kall: ` +
    [...byStatus]
      .map(([status, ids]) => `${status} ×${ids.length} (${ids.map((i) => `#${i}`).join(", ")})`)
      .join(", ") +
    ` · ${distinctBodies} ulike svar`;
  const details = all
    .sort((a, b) => a.id - b.id)
    .map((s) => describe(s, input.fields, BURST_BODY_CHARS))
    .join("\n\n---\n\n");
  return { content: session.redactor.redact(`${summary}\n\n${details}`) };
}

function truncate(text: string, maxChars = MAX_BODY_CHARS): string {
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n... [avkortet, ${text.length} tegn totalt - bruk inspect_call/fields for resten]`
    : text;
}
