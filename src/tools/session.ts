import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// Verktøy for øktnotater og funn - slik en utforskende tester fører logg.
// Strukturen (strict: true + zod) gjør at rapporten kan genereres uten å parse fritekst.

const Note = z.object({
  kind: z.enum(["observasjon", "spørsmål", "risiko", "ide", "pirk"]),
  text: z.string(),
});

const Finding = z.object({
  title: z.string(),
  severity: z.enum(["kritisk", "høy", "middels", "lav"]),
  steps: z.array(z.string()),
  expected: z.string(),
  actual: z.string(),
  evidence: z.string(),
});

export type SessionNote = z.infer<typeof Note>;
export type SessionFinding = z.infer<typeof Finding>;

export const recordNoteTool: Anthropic.Beta.BetaTool = {
  name: "record_note",
  description:
    "Før et øktnotat: noe du observerte, et åpent spørsmål, en risiko, en ide til videre testing, " +
    "eller en pirk (avvik fra konvensjoner/standarder som ikke er en ekte feil). " +
    "Bruk dette fortløpende - notatene er en del av leveransen.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["observasjon", "spørsmål", "risiko", "ide", "pirk"] },
      text: { type: "string" },
    },
    required: ["kind", "text"],
    additionalProperties: false,
  },
};

export const reportFindingTool: Anthropic.Beta.BetaTool = {
  name: "report_finding",
  description:
    "Rapporter et mulig avvik/feil. Bruk kun når du har reprodusert det og kan vise konkret bevis " +
    "(statuskode, responsutdrag). Skriv stegene slik at en utvikler kan gjenta dem.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      severity: { type: "string", enum: ["kritisk", "høy", "middels", "lav"] },
      steps: { type: "array", items: { type: "string" } },
      expected: { type: "string" },
      actual: { type: "string" },
      evidence: { type: "string", description: "Utdrag fra respons, statuskoder osv." },
    },
    required: ["title", "severity", "steps", "expected", "actual", "evidence"],
    additionalProperties: false,
  },
};

export function runRecordNote(rawInput: unknown, notes: SessionNote[]) {
  const parsed = Note.safeParse(rawInput);
  if (!parsed.success) return { content: `Ugyldig input: ${parsed.error.message}`, isError: true };
  notes.push(parsed.data);
  return { content: "Notert.", isError: false };
}

export function runReportFinding(rawInput: unknown, findings: SessionFinding[]) {
  const parsed = Finding.safeParse(rawInput);
  if (!parsed.success) return { content: `Ugyldig input: ${parsed.error.message}`, isError: true };
  findings.push(parsed.data);
  return { content: `Funn #${findings.length} registrert.`, isError: false };
}
