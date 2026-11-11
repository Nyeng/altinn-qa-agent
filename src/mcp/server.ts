// MCP-server rundt agentens egne verktøy, så de samme verktøyene kan brukes fra Claude Code lokalt.
// Dette er et tynt lag: verktøydefinisjonene, valideringen, sikkerhetsreglene og maskeringen er de samme som i
// agentløkka (tools/define.ts → runTool). Én server = én Session = ett miljø.
//
// Vi bruker SDK-ens lavnivå-Server og sender JSON-skjemaet fra toInputSchema(), i stedet for å gi SDK-en
// zod-skjemaene. Da blir skjemaet nøyaktig det samme som agenten får fra Claude API, uansett zod-versjon i SDK-en.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Session } from "../agent/session.js";
import { runTool, toInputSchema, type Tool } from "../tools/define.js";
import { mcpInstructions } from "./instructions.js";

export const SERVER_NAME = "altinn-qa";
export const SERVER_VERSION = "0.1.0";

export function createMcpServer(session: Session, tools: Tool[]): Server {
  const server = new Server(
    { name: `${SERVER_NAME}-${session.config.env}`, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: mcpInstructions(session.config, session.users.categories()),
    },
  );

  // Verktøylista er stabil for en gitt Session (samme rekkefølge og skjema som i agentløkka).
  const listed = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: toInputSchema(tool.input) as { type: "object"; [key: string]: unknown },
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // runTool validerer, fanger feil og maskerer hemmeligheter. Den kaster aldri.
    const out = await runTool(tools, request.params.name, request.params.arguments ?? {}, session);
    return {
      content: [{ type: "text" as const, text: out.content }],
      ...(out.isError ? { isError: true } : {}),
    };
  });

  return server;
}
