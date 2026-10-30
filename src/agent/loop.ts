// Manuell agentløkke - bevisst skrevet for hånd (ikke SDK-ens tool runner) for å lære mekanikken eksamen tester:
// stop_reason, tool_use → tool_result, meldingshistorikk, caching og grenser.
//
// Løkka er en ren funksjon av (klient, økt, verktøy): API-klienten injiseres, så den kan testes med en falsk modell.
// Den skriver ikke selv til terminalen - alt meldes som hendelser (onEvent).
import type Anthropic from "@anthropic-ai/sdk";
import { describeUser } from "../altinn/test-users.js";
import { runTool, toApiTool, type Tool } from "../tools/define.js";
import { estimateCostUsd, type Usage } from "./pricing.js";
import type { Check, Finding, HttpLogEntry, Session } from "./session.js";

/** Den delen av SDK-en løkka bruker: `client.beta.messages`. */
export type MessagesClient = {
  create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
};

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; label: string; isError: boolean }
  | { type: "wrap-up"; reason: string };

export type AgentResult = {
  summary: string;
  checks: Check[];
  findings: Finding[];
  httpLog: HttpLogEntry[];
  users: string[];
  steps: number;
  stopReason: string;
  usage: Usage;
  costUsd: number;
};

const MAX_OUTPUT_TOKENS = 16_000;
const MAX_WRAP_UP_ROUNDS = 2;

export async function runAgent(opts: {
  client: MessagesClient;
  session: Session;
  tools: Tool[];
  system: string;
  charter: string;
  onEvent?: (event: AgentEvent) => void;
}): Promise<AgentResult> {
  const { client, session, tools, system, charter, onEvent = () => {} } = opts;
  const { config } = session;
  const apiTools = tools.map(toApiTool);
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let steps = 0;
  let wrapUpRequested = false;
  let wrapUpRounds = 0;
  let summary = "";
  let stopReason = "";

  const configured = session.users.addConfigured(config.testUser);
  const intro = configured
    ? `Aktiv bruker fra start: ${describeUser(configured)}`
    : "Ingen aktiv bruker ennå - hent en med pick_test_user ut fra charteret.";
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Charter for denne økten:\n\n${charter}\n\n${intro}` },
  ];

  while (true) {
    const response = await client.create({
      model: config.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      tools: apiTools,
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
        onEvent({ type: "text", text: block.text });
      }
    }

    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") break; // end_turn, max_tokens, refusal ...
    const isStep = (name: string) => tools.find((t) => t.name === name)?.countsAsStep !== false;
    const toolUses = response.content.filter((b) => b.type === "tool_use");
    // Etter at budsjettet er brukt opp, får modellen fortsatt registrere krav og funn (record_check,
    // report_finding) - ellers mister rapporten det som faktisk ble testet. Nye handlinger avvises.
    if (wrapUpRequested && (wrapUpRounds++ >= MAX_WRAP_UP_ROUNDS || toolUses.every((b) => isStep(b.name)))) {
      stopReason = "timebox";
      onEvent({ type: "wrap-up", reason: "avslutter uten flere verktøykall" });
      break;
    }

    // Alle tool_result-blokker for én tur går i én og samme user-melding.
    const results: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      if (wrapUpRequested && isStep(block.name)) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content:
            "Budsjettet er brukt opp - ingen nye handlinger. Registrer resultatene med record_check/report_finding.",
          is_error: true,
        });
        continue;
      }
      // Bare handlinger teller som steg - oppslag (api_reference, inspect_call) og registrering
      // (record_check, report_finding) skal ikke spise av budsjettet for selve testingen.
      if (isStep(block.name)) steps++;
      const out = await runTool(tools, block.name, block.input, session);
      onEvent({ type: "tool", label: out.label, isError: Boolean(out.isError) });
      results.push({ type: "tool_result", tool_use_id: block.id, content: out.content, is_error: out.isError });
    }

    const reason = wrapUpRequested ? undefined : limitReached(steps, usage, config);
    if (reason) {
      wrapUpRequested = true;
      onEvent({ type: "wrap-up", reason });
      results.push({
        type: "text",
        text:
          `Tidsboksen er brukt opp (${reason}). Ikke gjør flere handlinger. Registrer nå ALLE krav med ` +
          `record_check (og ev. funn med report_finding) - også det du ikke rakk, med konkret årsak - og skriv ` +
          `deretter oppsummeringen.`,
      });
    }
    messages.push({ role: "user", content: results });
  }

  return {
    summary,
    checks: session.checks,
    findings: session.findings,
    httpLog: session.httpLog,
    users: session.users.all().map(describeUser),
    steps,
    stopReason,
    usage,
    costUsd: estimateCostUsd(config.model, usage),
  };
}

function limitReached(steps: number, usage: Usage, config: Session["config"]): string | undefined {
  if (steps >= config.maxSteps) return `maks ${config.maxSteps} handlinger`;
  const cost = estimateCostUsd(config.model, usage);
  if (cost >= config.maxSessionUsd) return `kostnadstaket på $${config.maxSessionUsd.toFixed(2)}`;
  return undefined;
}
