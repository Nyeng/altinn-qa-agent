import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SECRET_MARKER } from "../src/policy/redact.js";
import { runTool, toApiTool } from "../src/tools/define.js";
import { createTools } from "../src/tools/index.js";
import { json, SECRETS, testConfig, testSession, type SentRequest } from "./helpers.js";

describe("konfig", () => {
  it("leser K6-formatet og legger nøkler per sti", () => {
    const config = testConfig();
    const rules = config.apis.platform.headerRules;
    assert.deepEqual(
      rules.map((r) => [r.pathPrefix, r.secretName]),
      [
        ["/register/", "REGISTER_SUBSCRIPTION_KEY"],
        ["/authorization/", "AUTHORIZATION_SUBSCRIPTION_KEY"],
      ],
    );
    assert.equal(config.apis["am-bff"].baseUrl.href, "https://am.ui.at22.altinn.cloud/accessmanagement/api/v1");
    // Ukjente nøkler som SOAP_ER_PASSWORD regnes som hemmelige
    assert.ok(config.secrets.includes(SECRETS.soap));
  });

  it("stopper konfig som peker til feil miljø", () => {
    assert.throws(() => testConfig({ BASE_URL: "https://platform.tt02.altinn.no" }), /hører til at22/);
  });
});

describe("verktøydefinisjoner", () => {
  it("genererer gyldige skjemaer uten $schema, med additionalProperties: false", () => {
    const { session } = testSession();
    for (const tool of createTools(session).map(toApiTool)) {
      assert.equal(tool.input_schema.type, "object", tool.name);
      assert.equal((tool.input_schema as Record<string, unknown>).$schema, undefined, tool.name);
      assert.equal((tool.input_schema as Record<string, unknown>).additionalProperties, false, tool.name);
    }
  });

  it("gir is_error ved ugyldig input og ukjent verktøy, uten å kaste", async () => {
    const { session } = testSession();
    const tools = createTools(session);
    assert.equal((await runTool(tools, "finnes_ikke", {}, session)).isError, true);
    const bad = await runTool(tools, "http_request", { method: "GET", path: "uten-skråstrek", why: "x" }, session);
    assert.equal(bad.isError, true);
    assert.match(bad.content, /Ugyldig input/);
  });
});

describe("http_request", () => {
  async function asServiceOwner(handler: (req: SentRequest) => Response = () => json({})) {
    const { session, sent } = testSession(handler);
    const tools = createTools(session);
    await runTool(
      tools,
      "use_service_owner",
      { owner: "ttd", scopes: ["altinn:resourceregistry/resource.write"] },
      session,
    );
    const call = (input: Record<string, unknown>) => runTool(tools, "http_request", { why: "test", ...input }, session);
    return { session, sent, call };
  }

  it("krever aktiv bruker", async () => {
    const { session } = testSession();
    const out = await runTool(createTools(session), "http_request", { method: "GET", path: "/x", why: "t" }, session);
    assert.match(out.content, /Ingen aktiv bruker/);
  });

  it("legger på token og riktig nøkkel per sti, og overstyrer modellens headere", async () => {
    const { sent, call } = await asServiceOwner();
    await call({ method: "GET", path: "/register/api/v1/x", headers: { "Ocp-Apim-Subscription-Key": "falsk" } });
    await call({ method: "GET", path: "/authorization/api/v1/x" });
    await call({ method: "GET", path: "/accessmanagement/api/v1/x" });
    assert.equal(sent[0].headers.authorization, `Bearer ${SECRETS.token}`);
    assert.equal(sent[0].headers["ocp-apim-subscription-key"], SECRETS.register);
    assert.equal(sent[1].headers["ocp-apim-subscription-key"], SECRETS.authz);
    assert.equal(sent[2].headers["ocp-apim-subscription-key"], undefined);
  });

  it("viser lekket token som markør, aldri verdien - verken til modellen eller i loggen", async () => {
    const { session, call } = await asServiceOwner((req) => json({ echo: req.headers.authorization }, 500));
    const out = await call({ method: "POST", path: "/resourceregistry/api/v1/resource", body: "{}" });
    assert.ok(out.content.includes(SECRET_MARKER));
    const everything = out.content + JSON.stringify(session.httpLog);
    for (const secret of Object.values(SECRETS)) assert.ok(!everything.includes(secret), secret);
  });

  it("fields gir bare utvalgte verdier, men feilsvar vises i sin helhet", async () => {
    let status = 200;
    const { call } = await asServiceOwner(() => json({ data: [1, 2, 3], stack: "at Foo.Bar()" }, status));
    const ok = await call({ method: "GET", path: "/x", fields: ["data.#"] });
    assert.match(ok.content, /data\.# = 3/);
    assert.ok(!ok.content.includes("stack"));
    status = 500;
    const failed = await call({ method: "GET", path: "/x", fields: ["data.#"] });
    assert.ok(failed.content.includes("at Foo.Bar()"));
  });

  it("PUT er bare lov etter egen POST, og inspect_call leser lagret svar", async () => {
    const { session, sent, call } = await asServiceOwner((req) =>
      req.method === "POST" ? json({ identifier: "snoken-1" }, 201) : json({ ok: true, nested: { v: 42 } }),
    );
    assert.equal((await call({ method: "PUT", path: "/resource/snoken-1", body: "{}" })).isError, true);
    await call({ method: "POST", path: "/resource", body: '{"identifier":"snoken-1"}' });
    assert.equal((await call({ method: "PUT", path: "/resource/snoken-1", body: "{}" })).isError, undefined);
    assert.equal(sent.length, 2); // den avviste PUT-en ble aldri sendt

    const inspected = await runTool(createTools(session), "inspect_call", { call: 2, fields: ["nested.v"] }, session);
    assert.match(inspected.content, /nested\.v = 42/);
  });
});

describe("record_check og report_finding", () => {
  it("krever kall som finnes, og minst ett kall for testede krav", async () => {
    const { session } = testSession();
    const tools = createTools(session);
    const check = { criterion: "k", coverage: "c", source: "utledet", expected: "e", actual: "a" };
    assert.equal(
      (await runTool(tools, "record_check", { ...check, result: "bestått", calls: [] }, session)).isError,
      true,
    );
    assert.equal(
      (await runTool(tools, "record_check", { ...check, result: "bestått", calls: [7] }, session)).isError,
      true,
    );
    assert.equal(
      (await runTool(tools, "record_check", { ...check, result: "ikke testet", calls: [] }, session)).isError,
      undefined,
    );
    assert.equal(session.checks.length, 1);
  });
});
