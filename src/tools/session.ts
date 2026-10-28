import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { HttpLogEntry } from "./http.js";

// Det rapporten består av: akseptansekriterier med testresultat, og reproduserbare funn.
// Begge MÅ vise til faktiske kall (#ID fra http_request), så rapporten kan vise nøyaktig forespørsel og svar
// fra loggen i stedet for modellens egen gjengivelse.

const Check = z.object({
  criterion: z.string(),
  coverage: z.string(),
  source: z.string(),
  result: z.enum(["bestått", "feilet", "ikke testet"]),
  expected: z.string(),
  actual: z.string(),
  calls: z.array(z.number().int().positive()),
});

const Finding = z.object({
  title: z.string(),
  severity: z.enum(["kritisk", "høy", "middels", "lav"]),
  criterion: z.string(),
  expected: z.string(),
  actual: z.string(),
  calls: z.array(z.number().int().positive()).min(1),
});

export type SessionCheck = z.infer<typeof Check>;
export type SessionFinding = z.infer<typeof Finding>;

export const recordCheckTool: Anthropic.Beta.BetaTool = {
  name: "record_check",
  description:
    "Registrer resultatet for ett akseptansekriterium. `criterion`: én kort linje i klarspråk om funksjonaliteten. " +
    "`source`: f.eks. 'issue #4732', 'PR-beskrivelse' eller 'utledet'. `actual`: én kort setning om hva svaret viste. " +
    "`coverage`: hvordan kallene traff den ENDREDE kodestien (f.eks. 'limit=2 ga 4 sider, siste side full'). " +
    "Kan du ikke forklare det, er result 'ikke testet'. " +
    "`calls`: kall-ID-ene (#) som beviser resultatet. Krav du ikke rakk: result 'ikke testet' og calls [].",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      criterion: { type: "string" },
      coverage: { type: "string" },
      source: { type: "string" },
      result: { type: "string", enum: ["bestått", "feilet", "ikke testet"] },
      expected: { type: "string" },
      actual: { type: "string" },
      calls: { type: "array", items: { type: "integer" } },
    },
    required: ["criterion", "coverage", "source", "result", "expected", "actual", "calls"],
    additionalProperties: false,
  },
};

export const reportFindingTool: Anthropic.Beta.BetaTool = {
  name: "report_finding",
  description:
    "Rapporter et reelt avvik som en utvikler skal kunne reprodusere. Kun faktiske feil med bevis - ikke " +
    "kosmetikk, stil eller spekulasjon. `title`: kort. `expected`/`actual`: korte fraser (f.eks. '201', '500 FormatException'). " +
    "`calls`: kall-ID-ene (#) som reproduserer feilen, i rekkefølge - forespørsel og svar hentes automatisk fra loggen.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      severity: { type: "string", enum: ["kritisk", "høy", "middels", "lav"] },
      criterion: { type: "string" },
      expected: { type: "string" },
      actual: { type: "string" },
      calls: { type: "array", items: { type: "integer" } },
    },
    required: ["title", "severity", "criterion", "expected", "actual", "calls"],
    additionalProperties: false,
  },
};

function unknownCalls(calls: number[], log: HttpLogEntry[]) {
  return calls.filter((id) => !log.some((e) => e.id === id));
}

export function runRecordCheck(rawInput: unknown, checks: SessionCheck[], log: HttpLogEntry[]) {
  const parsed = Check.safeParse(rawInput);
  if (!parsed.success) return { content: `Ugyldig input: ${parsed.error.message}`, isError: true };
  const missing = unknownCalls(parsed.data.calls, log);
  if (missing.length) return { content: `Ukjente kall-ID-er: ${missing.join(", ")}`, isError: true };
  if (parsed.data.result !== "ikke testet" && parsed.data.calls.length === 0) {
    return { content: "Et testet krav må vise til minst ett kall (calls).", isError: true };
  }
  checks.push(parsed.data);
  return { content: `Krav ${checks.length} registrert.`, isError: false };
}

export function runReportFinding(rawInput: unknown, findings: SessionFinding[], log: HttpLogEntry[]) {
  const parsed = Finding.safeParse(rawInput);
  if (!parsed.success) return { content: `Ugyldig input: ${parsed.error.message}`, isError: true };
  const missing = unknownCalls(parsed.data.calls, log);
  if (missing.length) return { content: `Ukjente kall-ID-er: ${missing.join(", ")}`, isError: true };
  findings.push(parsed.data);
  return { content: `Funn #${findings.length} registrert.`, isError: false };
}
