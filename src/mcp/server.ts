// MCP-server rundt agentens egne verktøy, så de samme verktøyene kan brukes fra Claude Code lokalt.
// Dette er et tynt lag: verktøydefinisjonene, valideringen, sikkerhetsreglene og maskeringen er de samme som i
// agentløkka (tools/define.ts → runTool). Én server = ett miljø. I tillegg kommer verktøy for økten (mcp/tools.ts),
// og økten lagres på disk etter hvert kall (mcp/store.ts), så den overlever en omstart.
//
// Vi bruker SDK-ens lavnivå-Server og sender JSON-skjemaet fra toInputSchema(), i stedet for å gi SDK-en
// zod-skjemaene. Da blir skjemaet nøyaktig det samme som agenten får fra Claude API, uansett zod-versjon i SDK-en.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Session } from "../agent/session.js";
import { runTool, toInputSchema, type Tool } from "../tools/define.js";
import { createTools } from "../tools/index.js";
import { mcpInstructions } from "./instructions.js";
import type { SessionStore } from "./store.js";
import { createMcpTools } from "./tools.js";

export const SERVER_NAME = "altinn-qa";
export const SERVER_VERSION = "0.2.0";

export type McpServerOptions = {
  /** Lager en ny, initialisert Session (for reset_session). */
  newSession: () => Promise<Session>;
  /** Uten lager lever økten bare i minnet (tester). */
  store?: SessionStore;
  reportsDir?: string;
};

export function createMcpServer(initial: Session, options: McpServerOptions): Server {
  let session = initial;
  const { store } = options;
  if (store?.load(session)) {
    console.error(`Fortsetter lagret økt: ${session.httpLog.length} kall, ${session.users.all().length} brukere`);
  }

  // Verktøylista er stabil for en gitt konfig: skjemaene bygges fra den første økten, og en ny økt har samme konfig.
  const tools: Tool[] = [
    ...createTools(initial),
    ...createMcpTools({
      reportsDir: options.reportsDir ?? "reports",
      reset: async () => {
        const archived = store?.archive();
        session = await options.newSession();
        return `Ny, blank økt i ${session.config.env}.${archived ? ` Forrige økt er arkivert i ${archived}.` : ""}`;
      },
    }),
  ];

  const server = new Server(
    { name: `${SERVER_NAME}-${initial.config.env}`, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: mcpInstructions(initial.config, initial.users.categories()),
    },
  );

  const listed = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: toInputSchema(tool.input) as { type: "object"; [key: string]: unknown },
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // runTool validerer, fanger feil og maskerer hemmeligheter. Den kaster aldri.
    const out = await runTool(tools, request.params.name, request.params.arguments ?? {}, session);
    try {
      store?.save(session);
    } catch (err) {
      console.error(`Kunne ikke lagre økten: ${(err as Error).message}`);
    }
    return {
      content: [{ type: "text" as const, text: out.content }],
      ...(out.isError ? { isError: true } : {}),
    };
  });

  return server;
}
