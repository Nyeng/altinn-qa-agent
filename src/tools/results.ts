// Det rapporten består av: akseptansekriterier med resultat, og reproduserbare funn.
// Begge MÅ vise til faktiske kall (#ID fra http_request), så rapporten kan vise nøyaktig forespørsel og svar
// fra loggen i stedet for modellens egen gjengivelse.
import { z } from "zod";
import type { Session } from "../agent/session.js";
import { defineTool, type Tool } from "./define.js";

const missingCalls = (calls: number[], s: Session) => calls.filter((id) => !s.hasCall(id));

export const recordCheck = defineTool({
  name: "record_check",
  countsAsStep: false,
  description:
    "Registrer resultatet for ett akseptansekriterium. `criterion`: én kort linje i klarspråk om funksjonaliteten. " +
    "`coverage`: hvordan kallene traff den ENDREDE kodestien (f.eks. 'limit=2 ga 4 sider, siste side full'). " +
    "Kan du ikke forklare det, er result 'ikke testet'. " +
    "`source`: f.eks. 'issue #4732', 'PR-beskrivelse' eller 'utledet'. `actual`: én kort setning om hva svaret viste. " +
    "`calls`: kall-ID-ene (#) som beviser resultatet. Krav du ikke rakk: result 'ikke testet' og calls [].",
  strict: true,
  input: z.strictObject({
    criterion: z.string(),
    coverage: z.string(),
    source: z.string(),
    result: z.enum(["bestått", "feilet", "ikke testet"]),
    expected: z.string(),
    actual: z.string(),
    calls: z.array(z.number().int()),
  }),
  label: (i) => `📋 [${i.result}] ${i.criterion}`,
  run: (check, s) => {
    const missing = missingCalls(check.calls, s);
    if (missing.length) return { content: `Ukjente kall-ID-er: ${missing.join(", ")}`, isError: true };
    if (check.result !== "ikke testet" && check.calls.length === 0) {
      return { content: "Et testet krav må vise til minst ett kall (calls).", isError: true };
    }
    s.checks.push(check);
    return { content: `Krav ${s.checks.length} registrert.` };
  },
});

export const reportFinding = defineTool({
  name: "report_finding",
  countsAsStep: false,
  description:
    "Rapporter et reelt avvik som en utvikler skal kunne reprodusere. Kun faktiske feil med bevis - ikke " +
    "kosmetikk, stil eller spekulasjon. `title`: kort. `expected`/`actual`: korte fraser (f.eks. '201', '500 FormatException'). " +
    "`calls`: kall-ID-ene (#) som reproduserer feilen, i rekkefølge - forespørsel og svar hentes automatisk fra loggen.",
  strict: true,
  input: z.strictObject({
    title: z.string(),
    severity: z.enum(["kritisk", "høy", "middels", "lav"]),
    criterion: z.string(),
    expected: z.string(),
    actual: z.string(),
    calls: z.array(z.number().int()),
  }),
  label: (i) => `🐞 ${i.title}`,
  run: (finding, s) => {
    if (finding.calls.length === 0) return { content: "Et funn må vise til minst ett kall (calls).", isError: true };
    const missing = missingCalls(finding.calls, s);
    if (missing.length) return { content: `Ukjente kall-ID-er: ${missing.join(", ")}`, isError: true };
    s.findings.push(finding);
    return { content: `Funn #${s.findings.length} registrert.` };
  },
});

export const resultTools: Tool[] = [recordCheck, reportFinding];
