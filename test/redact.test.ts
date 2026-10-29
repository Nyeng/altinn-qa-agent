import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { Redactor, SECRET_MARKER, TOKEN_MARKER } from "../src/policy/redact.js";
import { defineTool, runTool } from "../src/tools/define.js";
import { testSession } from "./helpers.js";

const secret = "k3y/With+Special=Chars";

describe("redigering av hemmeligheter", () => {
  it("1. lengste verdi først - ingen biter av en lengre hemmelighet blir igjen", () => {
    const r = new Redactor(["abcdef", "abcdefghijkl"]);
    assert.equal(r.redact("x=abcdefghijkl"), `x=${SECRET_MARKER}`);
  });

  it("2. fanger omkodede varianter: JSON-escapet, URL-kodet og base64", () => {
    const r = new Redactor([secret]);
    const variants = [
      JSON.stringify({ v: secret }), // vanlig JSON
      '{"v":"k3y\\/With+Special=Chars"}', // JSON med escapet skråstrek
      `?v=${encodeURIComponent(secret)}`, // URL-kodet
      Buffer.from(secret).toString("base64"), // base64
    ];
    for (const text of variants) {
      const out = r.redact(text);
      assert.ok(out.includes(SECRET_MARKER), `ikke fanget: ${text}`);
      assert.ok(!out.includes("With+Special"), `rester igjen: ${out}`);
    }
  });

  it("3. fanger ukjente tokens via mønstre: JWT, avkortet JWT, Bearer og Basic", () => {
    const r = new Redactor();
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZlcmRp";
    assert.equal(r.redact(`token=${jwt}`), `token=${TOKEN_MARKER}`);
    assert.equal(r.redact("feil: eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOi"), `feil: ${TOKEN_MARKER}`); // avkortet
    assert.equal(r.redact('{"Authorization":"Bearer abc.def-ghi_123"}'), `{"Authorization":"Bearer ${TOKEN_MARKER}"}`);
    assert.equal(r.redact("Authorization: Basic dXNlcjpwYXNz"), `Authorization: Basic ${TOKEN_MARKER}`);
  });

  it("lar vanlige data og korte verdier være i fred", () => {
    const r = new Redactor(["abc"]);
    const text = '{"next":"https://x/changes?token=NzE2&limit=1","id":"a1b2c3","abc":"Bearer"}';
    assert.equal(r.redact(text), text);
  });

  it("kjent hemmelighet etter Bearer gir én markør, ikke to", () => {
    const r = new Redactor(["mitt-hemmelige-token"]);
    assert.equal(r.redact("Bearer mitt-hemmelige-token"), `Bearer ${SECRET_MARKER}`);
  });

  it("4. håndheves sentralt: et verktøy som glemmer å vaske, lekker likevel ikke", async () => {
    const { session } = testSession();
    session.redactor.add("superhemmelig-verdi");
    const leaky = defineTool({
      name: "lekk",
      description: "test",
      input: z.strictObject({}),
      run: () => ({ content: "svar: superhemmelig-verdi og eyJhbGciOiJIUzI1NiJ9.eyJhIjoiYiJ9.sig" }),
    });
    const out = await runTool([leaky], "lekk", {}, session);
    assert.equal(out.content, `svar: ${SECRET_MARKER} og ${TOKEN_MARKER}`);
  });
});
