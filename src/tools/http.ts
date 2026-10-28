import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config.js";

// Uke 1: agentens eneste "hender" er HTTP mot appens API.
// Sikkerhet ligger i koden, ikke i prompten:
//  - kun TARGET_BASE_URL sin vert er lov
//  - auth-header legges på her, og tokenet vaskes ut av alt som går tilbake til Claude
//  - DELETE er av med mindre QA_ALLOW_DELETE=true

const MAX_BODY_CHARS = 8000;

export const httpRequestTool: Anthropic.Beta.BetaTool = {
  name: "http_request",
  description:
    "Send en HTTP-forespørsel til appen som testes. `path` er relativ til appens base-URL " +
    "(f.eks. /ttd/min-app/api/v1/applicationmetadata). Autentisering legges på automatisk. " +
    "Returnerer status, utvalgte headere og body (avkortet ved behov).",
  input_schema: {
    type: "object",
    properties: {
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
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().startsWith("/"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  why: z.string(),
});

export type HttpLogEntry = {
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

  const url = new URL(input.path, config.target.baseUrl);
  if (url.host !== config.target.baseUrl.host) {
    return { content: `Avvist: ${url.host} er utenfor tillatt vert.`, isError: true };
  }

  const headers = new Headers(input.headers);
  headers.delete("authorization");
  if (config.target.bearerToken) {
    headers.set("authorization", `Bearer ${config.target.bearerToken}`);
  }

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: input.method,
      headers,
      body: input.body,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    log.push({ method: input.method, path: input.path, status: res.status, why: input.why, ms: Date.now() - started });

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
    log.push({ method: input.method, path: input.path, status: "feil", why: input.why, ms: Date.now() - started });
    return { content: redact(`Nettverksfeil: ${(err as Error).message}`), isError: true };
  }
}

// Belte og bukseseler: fjern tokenet hvis appen skulle speile det tilbake.
function redact(text: string): string {
  const token = config.target.bearerToken;
  return token ? text.replaceAll(token, "[REDACTED]") : text;
}
