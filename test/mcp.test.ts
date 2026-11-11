import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { toInputSchema } from "../src/tools/define.js";
import { createTools } from "../src/tools/index.js";
import { json, SECRETS, testSession, type SentRequest } from "./helpers.js";

type TextResult = { content: { type: string; text: string }[]; isError?: boolean };

/** Kobler en ekte MCP-klient til serveren i minnet - samme protokoll som Claude Code bruker over stdio. */
async function connect(handler?: (req: SentRequest) => Response) {
  const { session, sent } = testSession(handler);
  const tools = createTools(session);
  const server = createMcpServer(session, tools);
  const client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as TextResult;
  return { session, sent, tools, client, call };
}

describe("MCP-server", () => {
  it("lister de samme verktøyene og skjemaene som agenten får", async () => {
    const { tools, client } = await connect();
    const listed = (await client.listTools()).tools;
    assert.deepEqual(
      listed.map((t) => t.name),
      tools.map((t) => t.name),
    );
    for (const tool of tools) {
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
    const { call } = await connect();
    const bad = await call("http_request", { method: "GET", path: "uten-skråstrek", why: "x" });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /Ugyldig input/);
    assert.equal((await call("finnes_ikke", {})).isError, true);
    assert.match(
      (await call("http_request", { method: "GET", path: "/x", why: "t" })).content[0].text,
      /Ingen aktiv bruker/,
    );
  });

  it("gjør kallet med token og nøkkel, men viser aldri hemmelighetene", async () => {
    const { sent, call, session } = await connect(() => json({ leaked: SECRETS.token, key: SECRETS.register }));
    await call("use_service_owner", { owner: "ttd", scopes: ["altinn:resourceregistry/resource.write"] });
    const out = await call("http_request", { method: "GET", path: "/register/api/v1/x", why: "test" });

    assert.equal(out.isError, undefined);
    assert.equal(sent[0].headers.authorization, `Bearer ${SECRETS.token}`);
    assert.equal(sent[0].headers["ocp-apim-subscription-key"], SECRETS.register);
    assert.match(out.content[0].text, /Kall #1: HTTP 200/);
    assert.ok(!out.content[0].text.includes(SECRETS.token));
    assert.ok(!out.content[0].text.includes(SECRETS.register));
    assert.equal(session.httpLog.length, 1);
  });

  it("håndhever de samme sperrene som agenten (PUT bare mot egne data)", async () => {
    const { call, sent } = await connect();
    await call("use_service_owner", { owner: "ttd", scopes: ["altinn:resourceregistry/resource.write"] });
    const out = await call("http_request", { method: "PUT", path: "/resourceregistry/api/v1/resource/delt", why: "t" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /PUT er bare lov/);
    assert.equal(sent.length, 0);
  });
});
