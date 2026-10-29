import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-expect-error - JS-modul uten typer (skriptene kjøres med ren node i CI)
import { humanTitle, issueIntro, issueTitle, summary } from "../scripts/issue-text.mjs";

describe("issue-tekst", () => {
  it("fjerner conventional commit-prefiks fra tittelen", () => {
    assert.equal(humanTitle("bug(resource-registry): Fix next link"), "Fix next link");
    assert.equal(humanTitle("Feat (access-management): Add/Revoke main admin"), "Add/Revoke main admin");
    assert.equal(humanTitle("feat(roles)!: feature toggle to exclude roles"), "Feature toggle to exclude roles");
    assert.equal(humanTitle("Show edit text on closed accordion"), "Show edit text on closed accordion");
  });

  it("lager beskrivende tittel med id og miljø til slutt", () => {
    assert.equal(
      issueTitle({ title: "bug(resource-registry): Fix next link", number: 4613, env: "at22" }),
      "🕵️ Fix next link (altinn-auth#4613 · at22)",
    );
    assert.equal(
      issueTitle({ title: "Fjern A2-roller", number: 4674, env: "at22", isFeature: true }),
      "🕵️ Feature: Fjern A2-roller (altinn-auth#4674 · at22)",
    );
  });

  it("henter første meningsfulle avsnitt og hopper over maler", () => {
    const body = [
      "> Drafted with an AI assistant (Claude Code).",
      "",
      "**TL;DR**",
      "- **Problem:** POST with a malformed organization number returned 500 instead of a validation error.",
      "",
      "## Description",
      "Details here.",
    ].join("\n");
    assert.match(summary(body), /^- \*\*Problem:\*\* POST with a malformed/);
    assert.equal(summary(""), "");
    assert.match(
      issueIntro({
        title: "fix: x",
        body: "Dette er en tekst som er lang nok til å vises.",
        url: "https://u",
        kind: "PR",
      }),
      /^\*\*PR:\*\* \[X\]\(https:\/\/u\)\n\nDette er en tekst/,
    );
  });
});
