import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { systemPrompt } from "./prompts.js";
import { httpRequestTool, runHttpRequest, type HttpLogEntry } from "./tools/http.js";
import {
  recordNoteTool,
  reportFindingTool,
  runRecordNote,
  runReportFinding,
  type SessionFinding,
  type SessionNote,
} from "./tools/session.js";

// Manuell agentløkke - bevisst skrevet for hånd (ikke tool runner) for å lære
// mekanikken eksamen tester: stop_reason, tool_use/tool_result og meldingshistorikk.

export type SessionResult = {
  summary: string;
  notes: SessionNote[];
  findings: SessionFinding[];
  httpLog: HttpLogEntry[];
  steps: number;
  stopReason: string;
  usage: { input: number; output: number; cacheRead: number };
};

const client = new Anthropic();
const tools = [httpRequestTool, recordNoteTool, reportFindingTool];

export async function runSession(charter: string): Promise<SessionResult> {
  const notes: SessionNote[] = [];
  const findings: SessionFinding[] = [];
  const httpLog: HttpLogEntry[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  let steps = 0;
  let wrapUpRequested = false;
  let summary = "";
  let stopReason = "";

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Charter for denne økten:\n\n${charter}` },
  ];

  while (true) {
    const response = await client.beta.messages.create({
      model: config.model,
      max_tokens: 16000,
      system: systemPrompt(),
      tools,
      messages,
      output_config: { effort: config.effort },
      // Cacher prompt-prefikset (system + verktøy + historikk) mellom iterasjoner.
      cache_control: { type: "ephemeral" },
      // Ved avslag fra sikkerhetsfiltre kjøres forespørselen automatisk på en reservemodell.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    stopReason = response.stop_reason ?? "ukjent";

    // Hele content (inkl. thinking-blokker) må sendes tilbake uendret.
    messages.push({ role: "assistant", content: response.content });

    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        summary = block.text;
        console.log(`\n🤖 ${block.text}`);
      }
    }

    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") break; // end_turn, max_tokens, refusal ...

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (wrapUpRequested) {
      console.log("\n⏱️  Tidsboksen er brukt opp - avslutter uten flere verktøykall.");
      stopReason = "timebox";
      break;
    }

    // Alle tool_result-blokker for én tur går i én og samme user-melding.
    const results: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const use of toolUses) {
      steps++;
      const outcome = await executeTool(use, { notes, findings, httpLog });
      logToolCall(use, outcome.isError);
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: outcome.content,
        is_error: outcome.isError,
      });
    }

    if (steps >= config.maxSteps) {
      wrapUpRequested = true;
      results.push({
        type: "text",
        text: "Tidsboksen er brukt opp. Ikke gjør flere verktøykall - skriv oppsummeringen nå.",
      });
    }
    messages.push({ role: "user", content: results });
  }

  return { summary, notes, findings, httpLog, steps, stopReason, usage };
}

async function executeTool(
  use: Anthropic.Beta.BetaToolUseBlock,
  state: { notes: SessionNote[]; findings: SessionFinding[]; httpLog: HttpLogEntry[] },
): Promise<{ content: string; isError: boolean }> {
  switch (use.name) {
    case "http_request":
      return runHttpRequest(use.input, state.httpLog);
    case "record_note":
      return runRecordNote(use.input, state.notes);
    case "report_finding":
      return runReportFinding(use.input, state.findings);
    default:
      return { content: `Ukjent verktøy: ${use.name}`, isError: true };
  }
}

function logToolCall(use: Anthropic.Beta.BetaToolUseBlock, isError: boolean) {
  const input = use.input as Record<string, unknown>;
  const label =
    use.name === "http_request"
      ? `${input.method} ${input.path}  — ${input.why}`
      : use.name === "report_finding"
        ? `🐞 ${input.title}`
        : `📝 [${input.kind}] ${input.text}`;
  console.log(`${isError ? "⚠️ " : "→ "} ${label}`);
}
