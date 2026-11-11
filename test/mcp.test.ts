import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SessionStore } from "../src/mcp/store.js";
import { toInputSchema } from "../src/tools/define.js";
import { createTools } from "../src/tools/index.js";
import { json, SECRETS, testSession, type SentRequest } from "./helpers.js";

type TextResult = { content: { type: string; text: string }[]; isError?: boolean };
type Handler = (req: SentRequest) => Response | Promise<Response>;

const SO = { owner: "ttd", scopes: ["altinn:resourceregistry/resource.write"] };

/** Kobler en ekte MCP-klient til serveren i minnet - samme protokoll som Claude Code bruker over stdio. */
async function connect(handler?: Handler, opts: { store?: SessionStore; reportsDir?: string } = {}) {
  const { session, sent } = testSession(handler);
  const newSession = async () =>
    new (session.constructor as typeof import("../src/agent/session.js").Session)(session.config, {
      fetch: session.fetch,
      random: () => 0,
    });
  const server = createMcpServer(session, { newSession, ...opts });
  const client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as TextResult;
  const text = async (name: string, args: Record<string, unknown> = {}) => (await call(name, args)).content[0].text;
  return { session, sent, client, call, text };
}

const tempDir = () => mkdtempSync(path.join(tmpdir(), "snoken-mcp-"));

describe("MCP-server", () => {
  it("lister agentens verktøy med de samme skjemaene, pluss verktøyene for økten", async () => {
    const { session, client } = await connect();
    const agentTools = createTools(session);
    const listed = (await client.listTools()).tools;
    assert.deepEqual(
      listed.map((t) => t.name),
      [...agentTools.map((t) => t.name), "session_status", "reset_session", "write_report"],
    );
    for (const tool of agentTools) {
      const mcp = listed.find((t) => t.name === tool.name)!;
      assert.deepEqual(mcp.inputSchema, toInputSchema(tool.input), tool.name);
      assert.equal(mcp.description, tool.description);
    }
  });

  it("navngir serveren etter miljøet og gir instruksjoner", async () => {
    const { client } = await connect();
    assert.equal(client.getServerVersion()?.name, "altinn-qa-at22");
    assert.match(client.getInstructions() ?? "", /testmiljø at22/);
  });

  it("gir isError ved ugyldig input, ukjent verktøy og manglende bruker, uten å kaste", async () => {
    const { call, text } = await connect();
    const bad = await call("http_request", { method: "GET", path: "uten-skråstrek", why: "x" });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /Ugyldig input/);
    assert.equal((await call("finnes_ikke")).isError, true);
    assert.match(await text("http_request", { method: "GET", path: "/x", why: "t" }), /Ingen aktiv bruker/);
  });

  it("gjør kallet med token og nøkkel, men viser aldri hemmelighetene", async () => {
    const { sent, call, session } = await connect(() => json({ leaked: SECRETS.token, key: SECRETS.register }));
    await call("use_service_owner", SO);
    const out = await call("http_request", { method: "GET", path: "/register/api/v1/x", why: "test" });

    assert.equal(out.isError, undefined);
    assert.equal(sent[0].headers.authorization, `Bearer ${SECRETS.token}`);
    assert.equal(sent[0].headers["ocp-apim-subscription-key"], SECRETS.register);
    assert.match(out.content[0].text, /Kall #1: HTTP 200/);
    assert.ok(!out.content[0].text.includes(SECRETS.token));
    assert.ok(!out.content[0].text.includes(SECRETS.register));
    // Lagret svar (inspect_call og disk) er maskert allerede
    assert.ok(!session.responseBodies.get(1)!.includes(SECRETS.token));
  });

  it("håndhever de samme sperrene som agenten (PUT bare mot egne data)", async () => {
    const { call, sent } = await connect();
    await call("use_service_owner", SO);
    const out = await call("http_request", { method: "PUT", path: "/resourceregistry/api/v1/resource/delt", why: "t" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /PUT er bare lov/);
    assert.equal(sent.length, 0);
  });
});

describe("MCP-økten på disk", () => {
  const created: Handler = (req) =>
    req.method === "POST" ? json({ id: "snoken-ny" }, 201) : json({ ok: true, secret: SECRETS.token });

  it("fortsetter etter omstart: kall-logg, brukere, svar og egne data", async () => {
    const dir = tempDir();
    const first = await connect(created, { store: new SessionStore(dir) });
    await first.call("use_service_owner", SO);
    await first.call("http_request", { method: "POST", path: "/resource", body: '{"id":"snoken-ny"}', why: "lag" });
    await first.call("http_request", { method: "GET", path: "/resource/snoken-ny", why: "les" });

    const stateOnDisk = readFileSync(path.join(dir, "state.json"), "utf8");
    for (const secret of Object.values(SECRETS)) assert.ok(!stateOnDisk.includes(secret), secret);
    assert.ok(!readFileSync(path.join(dir, "bodies", "2.txt"), "utf8").includes(SECRETS.token));

    // Ny serverprosess mot samme mappe
    const second = await connect(created, { store: new SessionStore(dir) });
    assert.equal(second.session.httpLog.length, 2);
    assert.equal(second.session.users.active?.alias, "bruker-A");
    assert.match(await second.text("inspect_call", { call: 2, fields: ["ok"] }), /ok = true/);
    // PUT mot data fra før omstarten er fortsatt lov, og neste kall-ID fortsetter
    const put = await second.text("http_request", {
      method: "PUT",
      path: "/resource/snoken-ny",
      body: "{}",
      why: "endre",
    });
    assert.match(put, /Kall #3: HTTP 200/);
    assert.match(
      await second.text("session_status"),
      /3 kall.*\n.*bruker-A \(aktiv\)[\s\S]*Opprettet i økten: snoken-ny/,
    );
  });

  it("reset_session arkiverer økten og glemmer egne data", async () => {
    const dir = tempDir();
    const mcp = await connect(created, { store: new SessionStore(dir) });
    await mcp.call("use_service_owner", SO);
    await mcp.call("http_request", { method: "POST", path: "/resource", body: '{"id":"snoken-ny"}', why: "lag" });

    assert.match(await mcp.text("reset_session", { confirm: true }), /Forrige økt er arkivert/);
    assert.ok(existsSync(path.join(dir, "arkiv")));
    assert.match(await mcp.text("session_status"), /0 kall/);
    await mcp.call("use_service_owner", SO);
    const put = await mcp.call("http_request", { method: "PUT", path: "/resource/snoken-ny", body: "{}", why: "t" });
    assert.match(put.content[0].text, /PUT er bare lov/);
  });

  it("write_report skriver rapporten under reports-mappa, og ingen andre steder", async () => {
    const dir = tempDir();
    const mcp = await connect(created, { reportsDir: dir });
    await mcp.call("use_service_owner", SO);
    await mcp.call("http_request", { method: "GET", path: "/resource/x", why: "les" });
    await mcp.call("record_check", {
      criterion: "Ressursen kan leses",
      coverage: "GET",
      source: "utledet",
      result: "bestått",
      expected: "200",
      actual: "200",
      calls: [1],
    });

    const file = path.join(dir, "gui", "test.md");
    assert.match(await mcp.text("write_report", { file, title: "PR #1" }), /1 krav, 0 funn\)\. Status: ✅ Testet/);
    assert.match(readFileSync(file, "utf8"), /### 🕵️ PR #1 · at22[\s\S]*✅ Ressursen kan leses/);
    assert.equal((await mcp.call("write_report", { file: path.join(dir, "..", "utenfor.md") })).isError, true);
    assert.equal((await mcp.call("write_report", { file: path.join(dir, "rapport.txt") })).isError, true);
  });
});

describe("kompakt utdata", () => {
  const big = { data: Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}`, name: "x".repeat(100) })) };

  it("store vellykkede svar vises som struktur, feilsvar i sin helhet", async () => {
    let status = 200;
    const { call, text } = await connect(() => json(big, status));
    await call("use_service_owner", SO);
    const ok = await text("http_request", { method: "GET", path: "/x", why: "t" });
    assert.match(ok, /Struktur .*inspect_call #1/);
    assert.match(ok, /data: \[200 elementer, første: \{ id: "id-0", name: <tekst, 100 tegn> \}\]/);
    assert.ok(ok.length < 1000, `${ok.length} tegn`);
    status = 500;
    const failed = await text("http_request", { method: "GET", path: "/x", why: "t" });
    assert.ok(failed.includes('"id-199"') || failed.includes("avkortet"), "feilsvar skal ikke gjøres om til struktur");
    assert.ok(!failed.includes("Struktur"));
  });

  it("brief gir bare statuslinje og Location, men feilsvar vises likevel", async () => {
    let status = 201;
    const { call, text } = await connect(() => json({ id: "snoken-1" }, status, { location: "/resource/snoken-1" }));
    await call("use_service_owner", SO);
    const ok = await text("http_request", { method: "POST", path: "/resource", body: "{}", why: "t", brief: true });
    assert.match(ok, /^Kall #1: HTTP 201 .*\(\d+ ms, 17 tegn\)\nlocation: \/resource\/snoken-1$/);
    status = 400;
    assert.match(
      await text("http_request", { method: "POST", path: "/resource", body: "{}", why: "t", brief: true }),
      /snoken-1/,
    );
  });

  it("http_burst viser hele svaret bare for kall som feilet, og ett vellykket", async () => {
    let n = 0;
    const { call, text } = await connect(() => (n++ < 3 ? json({ ok: n }) : json({ title: "Conflict" }, 409)));
    await call("use_service_owner", SO);
    const out = await text("http_burst", { method: "GET", path: "/x", count: 5, why: "race" });
    assert.match(out, /200 ×3.*409 ×2/);
    assert.equal((out.match(/Kall #\d+: HTTP/g) ?? []).length, 3); // 1 vellykket + 2 feilet
    assert.match(out, /2 vellykkede svar til/);
  });
});
