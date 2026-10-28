import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { estimateCostUsd, type Usage } from "./pricing.js";
import { systemPrompt } from "./prompts.js";
import { addConfiguredUser, describeUser, knownUsers } from "./testusers.js";
import { httpRequestTool, runHttpRequest, type HttpLogEntry } from "./tools/http.js";
import {
  recordCheckTool,
  reportFindingTool,
  runRecordCheck,
  runReportFinding,
  type SessionCheck,
  type SessionFinding,
} from "./tools/session.js";
import {
  pickTestUserTool,
  runPickTestUser,
  runSwitchUser,
  runUseServiceOwner,
  setActiveUser,
  switchUserTool,
  useServiceOwnerTool,
} from "./tools/users.js";

// Manuell agentløkke - bevisst skrevet for hånd (ikke tool runner) for å lære
// mekanikken eksamen tester: stop_reason, tool_use/tool_result og meldingshistorikk.

export type SessionResult = {
  summary: string;
  checks: SessionCheck[];
  findings: SessionFinding[];
  httpLog: HttpLogEntry[];
  users: string[];
  steps: number;
  stopReason: string;
  usage: Usage;
  costUsd: number;
};

const client = new Anthropic();
const tools = [pickTestUserTool, useServiceOwnerTool, switchUserTool, httpRequestTool, recordCheckTool, reportFindingTool];

export async function runSession(charter: string): Promise<SessionResult> {
  const checks: SessionCheck[] = [];
  const findings: SessionFinding[] = [];
  const httpLog: HttpLogEntry[] = [];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let steps = 0;
  let wrapUpRequested = false;
  let summary = "";
  let stopReason = "";

  const configured = addConfiguredUser();
  if (configured) setActiveUser(configured);
  const intro = configured
    ? `Aktiv bruker fra start: ${describeUser(configured)}`
    : "Ingen aktiv bruker ennå - hent en med pick_test_user ut fra charteret.";

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Charter for denne økten:\n\n${charter}\n\n${intro}` },
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
    usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
    stopReason = response.stop_reason ?? "ukjent";

    // Hele content (inkl. thinking-blokker) må sendes tilbake uendret.
    messages.push({ role: "assistant", content: response.content });

    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        summary = block.text;
        console.log(`\n🕵️ ${block.text}`);
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
      const outcome = await executeTool(use, { checks, findings, httpLog });
      logToolCall(use, outcome.isError);
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: outcome.content,
        is_error: outcome.isError,
      });
    }

    const tokensUsed = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    const reason =
      steps >= config.maxSteps
        ? `maks ${config.maxSteps} verktøykall`
        : tokensUsed >= config.maxSessionTokens
          ? `tokentaket på ${config.maxSessionTokens.toLocaleString("nb-NO")}`
          : undefined;
    if (reason) {
      wrapUpRequested = true;
      results.push({
        type: "text",
        text: `Tidsboksen er brukt opp (${reason}). Ikke gjør flere verktøykall - skriv oppsummeringen nå.`,
      });
    }
    messages.push({ role: "user", content: results });
  }

  return {
    summary,
    checks,
    findings,
    httpLog,
    users: knownUsers().map(describeUser),
    steps,
    stopReason,
    usage,
    costUsd: estimateCostUsd(config.model, usage),
  };
}

async function executeTool(
  use: Anthropic.Beta.BetaToolUseBlock,
  state: { checks: SessionCheck[]; findings: SessionFinding[]; httpLog: HttpLogEntry[] },
): Promise<{ content: string; isError: boolean }> {
  switch (use.name) {
    case "pick_test_user":
      return runPickTestUser(use.input);
    case "switch_user":
      return runSwitchUser(use.input);
    case "use_service_owner":
      return runUseServiceOwner(use.input);
    case "http_request":
      return runHttpRequest(use.input, state.httpLog);
    case "record_check":
      return runRecordCheck(use.input, state.checks, state.httpLog);
    case "report_finding":
      return runReportFinding(use.input, state.findings, state.httpLog);
    default:
      return { content: `Ukjent verktøy: ${use.name}`, isError: true };
  }
}

function logToolCall(use: Anthropic.Beta.BetaToolUseBlock, isError: boolean) {
  const input = use.input as Record<string, unknown>;
  const label =
    use.name === "http_request"
      ? `${input.api ?? "platform"} ${input.method} ${input.path}  — ${input.why}`
      : use.name === "report_finding"
        ? `🐞 ${input.title}`
        : use.name === "pick_test_user"
          ? `👤 ny bruker fra ${input.category}`
          : use.name === "use_service_owner"
            ? `🏛️ tjenesteeier ${input.owner} (${(input.scopes as string[]).join(", ")})`
            : use.name === "switch_user"
            ? `👤 bytter til ${input.alias}`
            : use.name === "record_check"
              ? `📋 [${input.result}] ${input.criterion}`
              : `${use.name}`;
  console.log(`${isError ? "⚠️ " : "→ "} ${label}`);
}
