import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-expect-error - JS-modul uten typer (skriptene kjøres med ren node i CI)
import { overviewBody } from "../scripts/poll-altinn-auth.mjs";

const issue = (number: number, state: string, status: string, labels: string[] = []) => ({
  number,
  state,
  body: `**Status:** ${status}\n\ntekst`,
  labels: labels.map((name) => ({ name })),
});

describe("oversikt", () => {
  it("deler forespørslene i funn, kjører, venter på flagg/deploy og ferdig uten funn", () => {
    const body = overviewBody([
      issue(1, "OPEN", "🟡 Delvis testet", ["snoken", "funn"]),
      issue(2, "CLOSED", "▶️ Kjører."),
      issue(3, "CLOSED", "🚩 Venter på at X slås på i at22", ["snoken-venter"]),
      issue(4, "CLOSED", "⏳ Merget, men ikke deployet ennå", ["snoken-venter"]),
      issue(5, "CLOSED", "✅ Testet 2026-11-04 i at22"),
      issue(6, "CLOSED", "⏹️ Kjøres ikke"),
      issue(7, "OPEN", "", ["snoken-oversikt"]),
    ]);
    const section = (title: string) => body.split(`### ${title}`)[1].split("###")[0];
    assert.match(section("🔎 Til vurdering (funn)"), /#1 /);
    assert.match(section("▶️ Kjører"), /#2 /);
    assert.match(section("🚩 Venter på feature-flagg"), /#3 /);
    assert.match(section("⏳ Venter på merge eller deploy"), /#4 /);
    assert.match(section("✔️ Ferdig (lukket, siste 15)"), /#5 /);
    assert.doesNotMatch(body, /#6 |#7 /);
  });
});
