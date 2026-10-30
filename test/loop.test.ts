import type Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runAgent, type MessagesClient } from "../src/agent/loop.js";
import { createTools } from "../src/tools/index.js";
import { testSession } from "./helpers.js";

type Block = Anthropic.Beta.BetaContentBlock;
const usage = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 };

/** Falsk modell: svarer med forhåndsdefinerte meldinger og husker forespørslene. */
function scriptedClient(turns: { stop: string; content: unknown[] }[]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    async create(params) {
      // Kopi av meldingene - løkka fortsetter å legge til i samme liste.
      requests.push({ ...params, messages: structuredClone(params.messages) });
      const turn = turns[requests.length - 1] ?? { stop: "end_turn", content: [{ type: "text", text: "slutt" }] };
      return {
        content: turn.content as Block[],
        stop_reason: turn.stop,
        usage,
      } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
  return { client, requests };
}

const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });

describe("agentløkka", () => {
  it("kjører verktøy, sender alle tool_results i én melding og stopper ved end_turn", async () => {
    const { session } = testSession();
    const { client, requests } = scriptedClient([
      {
        stop: "tool_use",
        content: [
          toolUse("t1", "switch_user", { alias: "finnes-ikke" }),
          toolUse("t2", "record_check", {
            criterion: "k",
            coverage: "c",
            source: "utledet",
            result: "ikke testet",
            expected: "e",
            actual: "a",
            calls: [],
          }),
        ],
      },
      { stop: "end_turn", content: [{ type: "text", text: "Ferdig." }] },
    ]);

    const result = await runAgent({ client, session, tools: createTools(session), system: "s", charter: "c" });

    assert.equal(requests.length, 2);
    const last = requests[1].messages.at(-1)!;
    assert.equal(last.role, "user");
    const results = last.content as Anthropic.Beta.BetaToolResultBlockParam[];
    assert.deepEqual(
      results.map((r) => [r.tool_use_id, r.is_error]),
      [
        ["t1", true],
        ["t2", undefined],
      ],
    );
    assert.equal(result.summary, "Ferdig.");
    assert.equal(result.steps, 1); // switch_user teller, record_check (registrering) gjør ikke
    assert.equal(result.checks.length, 1);
    assert.equal(result.usage.input, 200);
    assert.equal(result.usage.cacheRead, 100);
  });

  it("ber om oppsummering når maks steg er nådd, og stopper hvis modellen fortsetter", async () => {
    const { session } = testSession();
    session.config.maxSteps = 1;
    const loopTurn = { stop: "tool_use", content: [toolUse("t", "switch_user", { alias: "x" })] };
    const { client, requests } = scriptedClient([loopTurn, loopTurn, loopTurn]);

    const result = await runAgent({ client, session, tools: createTools(session), system: "s", charter: "c" });

    assert.equal(requests.length, 2);
    const wrapUp = (requests[1].messages.at(-1)!.content as { type: string; text?: string }[]).at(-1)!;
    assert.match(wrapUp.text ?? "", /Tidsboksen er brukt opp/);
    assert.equal(result.stopReason, "timebox");
  });

  it("lar modellen registrere krav etter at budsjettet er brukt opp, men avviser nye handlinger", async () => {
    const { session } = testSession();
    session.config.maxSteps = 1;
    const check = {
      criterion: "k",
      coverage: "c",
      source: "utledet",
      result: "ikke testet",
      expected: "e",
      actual: "a",
      calls: [],
    };
    const { client, requests } = scriptedClient([
      { stop: "tool_use", content: [toolUse("t1", "switch_user", { alias: "x" })] },
      {
        stop: "tool_use",
        content: [toolUse("t2", "record_check", check), toolUse("t3", "switch_user", { alias: "y" })],
      },
      { stop: "end_turn", content: [{ type: "text", text: "Oppsummert." }] },
    ]);

    const result = await runAgent({ client, session, tools: createTools(session), system: "s", charter: "c" });

    assert.equal(result.checks.length, 1);
    const results = requests[2].messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    assert.equal(results.find((r) => r.tool_use_id === "t3")?.is_error, true);
    assert.equal(result.summary, "Oppsummert.");
  });

  it("sender stabil systemprompt og verktøyliste med cache_control", async () => {
    const { session } = testSession();
    const { client, requests } = scriptedClient([]);
    await runAgent({ client, session, tools: createTools(session), system: "fast", charter: "c" });
    assert.equal(requests[0].system, "fast");
    assert.deepEqual(requests[0].cache_control, { type: "ephemeral" });
    assert.equal(requests[0].tools?.length, createTools(session).length);
  });
});
