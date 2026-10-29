// Verktøyregister: hvert verktøy defineres ett sted (navn, beskrivelse, zod-skjema, handler).
// JSON-skjemaet som sendes til API-et genereres fra zod, så validering og skjema aldri kan komme ut av sync.
// Validering, feilhåndtering og redigering av hemmeligheter skjer sentralt: ugyldig input og exceptions blir
// tool_result med is_error,
// så modellen kan rette seg - løkka krasjer aldri på grunn av et verktøy.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Session } from "../agent/session.js";

export type ToolOutput = { content: string; isError?: boolean };

export type Tool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: S;
  /** strict: true gir skjemagaranti fra API-et. Skjemaet må da være enkelt (ingen min/max o.l.). */
  strict?: boolean;
  run(input: z.infer<S>, session: Session): ToolOutput | Promise<ToolOutput>;
  /** Kort linje til terminal/logg. */
  label?(input: z.infer<S>): string;
};

export function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<S> {
  return tool;
}

/** Verktøydefinisjonen API-et forventer. */
export function toApiTool(tool: Tool): Anthropic.Beta.BetaTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: toInputSchema(tool.input),
    ...(tool.strict ? { strict: true } : {}),
  };
}

export function toInputSchema(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const json = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  return stripUnsupported(json) as Anthropic.Beta.BetaTool.InputSchema;
}

// Fjerner nøkkelord API-et ikke trenger eller ikke støtter i strict-modus (zod legger dem til automatisk).
function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$schema" || k === "propertyNames") continue;
    if ((k === "minimum" || k === "maximum") && Math.abs(Number(v)) === Number.MAX_SAFE_INTEGER) continue;
    out[k] = stripUnsupported(v);
  }
  return out;
}

export type ToolCallResult = ToolOutput & { label: string };

/** Validerer input og kjører verktøyet. Feil blir is_error-resultater, ikke exceptions. */
export async function runTool(
  tools: Tool[],
  name: string,
  rawInput: unknown,
  session: Session,
): Promise<ToolCallResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { content: `Ukjent verktøy: ${name}`, isError: true, label: name };

  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    return { content: `Ugyldig input: ${z.prettifyError(parsed.error)}`, isError: true, label: name };
  }
  const label = tool.label?.(parsed.data) ?? name;
  try {
    const out = await tool.run(parsed.data, session);
    // Sentral redigering: ALT som går tilbake til modellen vaskes her, også fra verktøy som glemmer det selv.
    return { ...out, content: session.redactor.redact(out.content), label };
  } catch (err) {
    return { content: session.redactor.redact(`Feil i ${name}: ${(err as Error).message}`), isError: true, label };
  }
}
