import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentResult } from "../src/agent/loop.js";
import { renderReport } from "../src/report/render.js";

const result = {
  checks: [
    {
      criterion: "Tom side har ikke next",
      coverage: "",
      source: "utledet",
      result: "bestått",
      expected: "",
      actual: "",
      calls: [1],
    },
    {
      criterion: "PUT trimmer",
      coverage: "",
      source: "issue",
      result: "ikke testet",
      expected: "",
      actual: "",
      calls: [],
    },
  ],
  findings: [
    { title: "500 ved mellomrom", severity: "middels", criterion: "#4732", expected: "201", actual: "500", calls: [1] },
  ],
  httpLog: [
    {
      id: 1,
      user: "bruker-A",
      auth: "<token>",
      api: "platform",
      method: "POST",
      path: "/r",
      url: "https://platform.at22.altinn.cloud/r",
      requestHeaders: { "content-type": "application/json" },
      requestBody: '{"a":1}',
      status: 500,
      responseExcerpt: "boom",
      why: "",
      ms: 1,
    },
  ],
  costUsd: 0.07,
} as unknown as AgentResult;

describe("rapport", () => {
  it("er en kort punktliste med reproduksjon og bunnlinje", () => {
    const md = renderReport(result, {
      env: "at22",
      model: "claude-sonnet-5-5",
      title: "PR #1 🟢",
      runUrl: "https://run",
    });
    assert.match(md, /^### 🕵️ PR #1 🟢 · at22/);
    assert.match(md, /- ✅ Tom side har ikke next/);
    assert.match(md, /- ⚪ Ikke testet: PUT trimmer/);
    assert.match(md, /🐞 \*\*500 ved mellomrom\*\*/);
    assert.match(md, /curl -i -X POST 'https:\/\/platform\.at22\.altinn\.cloud\/r'/);
    assert.match(md, /claude-sonnet-5-5 · 1 kall · \$0\.07 · \[logg\]\(https:\/\/run\)/);
  });
});
