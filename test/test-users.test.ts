import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TestUserPool } from "../src/altinn/test-users.js";
import { Redactor } from "../src/policy/redact.js";

const pool = () => new TestUserPool({ env: "at23", testdataBaseUrl: "https://ikke-i-bruk", redactor: new Redactor() });

describe("klientvirksomheter (lokal testdata)", () => {
  it("er tilgjengelig for både API- og GUI-testing", () => {
    assert.ok(
      pool()
        .categories()
        .some((c) => c.id === "klientvirksomhet"),
    );
  });

  it("leser miljøets fil i repoet, én bruker per profil", async () => {
    const p = pool();
    const users = [];
    for (let i = 0; i < 5; i++) users.push(await p.pick("klientvirksomhet"));
    assert.equal(new Set(users.map((u) => u.context.profile)).size, 5);
    await assert.rejects(p.pick("klientvirksomhet"), /Ingen flere ubrukte/);
  });

  it("gir noen av aktørens klienter fra profilens fil som kontekst", async () => {
    const p = pool();
    for (let i = 0; i < 5; i++) {
      const user = await p.pick("klientvirksomhet");
      const clients = user.context.klienter.split(" | ");
      assert.ok(clients.length >= 1 && clients.length <= 5, user.context.profile);
    }
  });
});
