import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsv, TestUserPool } from "../src/altinn/test-users.js";
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

  it("leser fila i repoet og velger bare rader for miljøet", async () => {
    const p = pool();
    const users = [];
    for (let i = 0; i < 5; i++) users.push(await p.pick("klientvirksomhet"));
    assert.equal(new Set(users.map((u) => u.context.profil)).size, 5);
    await assert.rejects(p.pick("klientvirksomhet"), /Ingen flere ubrukte/);
  });

  it("gir noen av aktørens klienter som kontekst", async () => {
    const user = await pool().pick("klientvirksomhet");
    const orgnr = user.context.aktorOrgnr.split(" ")[0];
    assert.ok(orgnr);
    const clients = user.context.klienter.split(" | ");
    assert.ok(clients.length >= 1 && clients.length <= 5);
  });
});

describe("CSV", () => {
  it("håndterer komma og anførselstegn i siterte verdier", () => {
    assert.deepEqual(parseCsv('a,b,c\n1,"x, y","si ""hei"""\n'), [{ a: "1", b: "x, y", c: 'si "hei"' }]);
  });
});
