import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getToken, secretsToRedact } from "../auth.js";
import { activeUser } from "./users.js";
import { config } from "../config.js";
import { assertAllowedHost } from "../environments.js";

// Uke 1: agentens eneste "hender" er HTTP mot appens API.
// Sikkerhet ligger i koden, ikke i prompten:
//  - kun API-ene i miljøets konfig er lov, og kun verter i Altinns testmiljøer (hardkodet)
//  - token og hemmelige headere (API-nøkler) legges på her, og vaskes ut av alt som går tilbake til Claude
//  - DELETE er av med mindre QA_ALLOW_DELETE=true

const MAX_BODY_CHARS = 8000;

const apiNames = Object.keys(config.target.apis);
const apiList = Object.entries(config.target.apis)
  .map(([name, api]) => `- ${name}: ${api.description || api.baseUrl.origin}`)
  .join("\n");

export const httpRequestTool: Anthropic.Beta.BetaTool = {
  name: "http_request",
  description:
    "Send en HTTP-forespørsel til et av API-ene du har tilgang til. `path` er relativ til API-ets base-URL " +
    '(f.eks. /accessmanagement/api/v1/enduser/authorizedparties for "platform"). ' +
    "Kallet gjøres som aktiv testbruker; autentisering og API-nøkler legges på automatisk - ikke send dem selv. " +
    "Returnerer status, utvalgte headere og body (avkortet ved behov).\n\nTilgjengelige API-er:\n" +
    apiList,
  input_schema: {
    type: "object",
    properties: {
      api: { type: "string", enum: apiNames, description: "Hvilket API" },
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      path: { type: "string", description: "Sti relativ til base-URL, må starte med /" },
      headers: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Ekstra headere, f.eks. Content-Type. Ikke send Authorization.",
      },
      body: { type: "string", description: "Request-body som tekst (typisk JSON eller XML)" },
      why: { type: "string", description: "Kort: hva du vil lære av denne forespørselen" },
    },
    required: ["method", "path", "why"],
    additionalProperties: false,
  },
};

const HttpInput = z.object({
  api: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().startsWith("/"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  why: z.string(),
});

export type HttpLogEntry = {
  user: string;
  api: string;
  method: string;
  path: string;
  status: number | "feil";
  why: string;
  ms: number;
};

export async function runHttpRequest(
  rawInput: unknown,
  log: HttpLogEntry[],
): Promise<{ content: string; isError: boolean }> {
  const parsed = HttpInput.safeParse(rawInput);
  if (!parsed.success) {
    return { content: `Ugyldig input: ${parsed.error.message}`, isError: true };
  }
  const input = parsed.data;

  if (input.method === "DELETE" && !config.target.allowDelete) {
    return { content: "DELETE er deaktivert for denne økten (QA_ALLOW_DELETE=false).", isError: true };
  }

  const user = activeUser();
  if (!user) return { content: "Ingen aktiv bruker. Hent en med pick_test_user først.", isError: true };

  const api = config.target.apis[input.api];
  if (!api) return { content: `Ukjent API "${input.api}". Tilgjengelige: ${apiNames.join(", ")}`, isError: true };

  // Sti er relativ til API-ets base-URL (også når base-URL-en har en sti, f.eks. /storage/api/v1).
  const base = api.baseUrl.href.endsWith("/") ? api.baseUrl.href : `${api.baseUrl.href}/`;
  const url = new URL(input.path.replace(/^\/+/, ""), base);
  if (url.host !== api.baseUrl.host) {
    return { content: `Avvist: ${url.host} er utenfor tillatt vert.`, isError: true };
  }
  try {
    assertAllowedHost(url);
  } catch (err) {
    return { content: (err as Error).message, isError: true };
  }

  // Modellen får ikke sette auth eller noen av de hemmelige headerne selv.
  const headers = new Headers(input.headers);
  headers.delete("authorization");
  for (const rule of api.headerRules) for (const name of Object.keys(rule.headers)) headers.delete(name);

  // Hemmelige headere for denne stien (f.eks. register- vs. authorization-nøkkel på platform).
  const relativePath = `/${input.path.replace(/^\/+/, "")}`;
  const secretHeaders = api.headerRules
    .filter((rule) => relativePath.startsWith(rule.pathPrefix))
    .flatMap((rule) => Object.entries(rule.headers));

  const started = Date.now();
  try {
    headers.set("authorization", `Bearer ${await getToken(user)}`);
    for (const [name, value] of secretHeaders) headers.set(name, value);

    const res = await fetch(url, {
      method: input.method,
      headers,
      body: input.body,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    log.push({ user: user.alias, api: input.api, method: input.method, path: input.path, status: res.status, why: input.why, ms: Date.now() - started });

    const shownHeaders = ["content-type", "location", "www-authenticate"]
      .map((h) => [h, res.headers.get(h)] as const)
      .filter(([, v]) => v)
      .map(([h, v]) => `${h}: ${v}`)
      .join("\n");
    const body =
      text.length > MAX_BODY_CHARS
        ? `${text.slice(0, MAX_BODY_CHARS)}\n... [avkortet, ${text.length} tegn totalt]`
        : text;

    return {
      content: redact(`HTTP ${res.status} ${res.statusText} (${Date.now() - started} ms)\n${shownHeaders}\n\n${body}`),
      isError: false,
    };
  } catch (err) {
    log.push({ user: user.alias, api: input.api, method: input.method, path: input.path, status: "feil", why: input.why, ms: Date.now() - started });
    return { content: redact(`Nettverksfeil: ${(err as Error).message}`), isError: true };
  }
}

// Belte og bukseseler: fjern hemmeligheter hvis appen skulle speile dem tilbake.
function redact(text: string): string {
  return secretsToRedact().reduce((t, secret) => t.replaceAll(secret, "[REDACTED]"), text);
}
