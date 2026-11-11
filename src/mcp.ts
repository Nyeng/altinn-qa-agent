// Starter MCP-serveren for ett miljø over stdio. Brukes fra Claude Code via .mcp.json.
// Bruk: tsx --env-file-if-exists=.env src/mcp.ts --env=at22
//
// stdout er protokollkanalen: alt annet enn MCP-meldinger der ødelegger tilkoblingen. Logg derfor til stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Session } from "./agent/session.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./mcp/server.js";
import { SessionStore } from "./mcp/store.js";

const config = loadConfig();
const newSession = async () => {
  const session = new Session(config, { githubToken: process.env.GH_TOKEN || process.env.GITHUB_TOKEN });
  await session.init(); // scopes for tjenesteeier må være lest før verktøyskjemaene bygges
  return session;
};

const server = createMcpServer(await newSession(), { newSession, store: SessionStore.forEnv(config.env) });
await server.connect(new StdioServerTransport());
console.error(`Son of Vegard MCP kjører mot ${config.env} (API-er: ${Object.keys(config.apis).join(", ")})`);
