// Verktøy som bare gir mening i MCP-modus, der én serverprosess lever på tvers av Claude Code-økter:
// status for økten, blank start, og rapport til fil. Agentløkka har sin egen rapport (explore.ts).
// Ingen sikkerhetslogikk her (se AGENTS.md) - bare livssyklus og rapport.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Session } from "../agent/session.js";
import { renderReport, runStatus } from "../report/render.js";
import { defineTool, type Tool } from "../tools/define.js";

export type McpContext = {
  /** Arkiverer lagret økt og starter en ny, blank Session. */
  reset(): Promise<string>;
  /** Rotmappa rapporter kan skrives under. */
  reportsDir: string;
};

export function createMcpTools(ctx: McpContext): Tool[] {
  const sessionStatus = defineTool({
    name: "session_status",
    countsAsStep: false,
    description:
      "Vis status for økten: miljø, antall kall, testbrukere (alias og aktiv), data økten har opprettet " +
      "(PUT/PATCH/DELETE er bare lov mot dem), og registrerte krav og funn. Økten lagres på disk og fortsetter " +
      "etter omstart av serveren.",
    input: z.strictObject({}),
    label: () => "📊 status",
    run: (_, s) => ({ content: describeSession(s) }),
  });

  const resetSession = defineTool({
    name: "reset_session",
    countsAsStep: false,
    description:
      "Start en ny, blank økt: kall-logg, brukere, krav, funn og opprettede data glemmes (den gamle økten arkiveres " +
      "under reports/mcp). Bruk når du begynner på en ny test. Etterpå er PUT/PATCH/DELETE ikke lenger lov mot data " +
      "fra den gamle økten.",
    input: z.strictObject({ confirm: z.literal(true).describe("Må være true") }),
    label: () => "🧹 ny økt",
    run: async () => ({ content: await ctx.reset() }),
  });

  const writeReport = defineTool({
    name: "write_report",
    countsAsStep: false,
    description:
      "Skriv rapporten for økten til fil, i samme format som agenten: Verifisert (fra record_check) og Funn (fra " +
      "report_finding, med curl og svar fra kall-loggen). `file` er en .md-sti under reports/, f.eks. " +
      "reports/gui/feature-4603-at22.md (publiseres med scripts/publish-gui.mjs). Returnerer stien og statuslinjen.",
    input: z.strictObject({
      file: z.string().describe("Sti under reports/ som slutter på .md"),
      title: z.string().optional().describe('Overskrift, f.eks. "PR #4895"'),
    }),
    label: (i) => `📄 rapport ${i.file}`,
    run: ({ file, title }, s) => {
      const target = path.resolve(file);
      const root = path.resolve(ctx.reportsDir);
      if (!target.startsWith(`${root}${path.sep}`) || !target.endsWith(".md")) {
        return { content: `file må være en .md-fil under ${ctx.reportsDir}/`, isError: true };
      }
      const report = renderReport(
        {
          summary: "",
          checks: s.checks,
          findings: s.findings,
          httpLog: s.httpLog,
          users: s.users.all().map((u) => u.alias),
          steps: s.httpLog.length,
          stopReason: "mcp",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          costUsd: Number.NaN,
        },
        { env: s.config.env, model: "Claude Code (MCP)", title, testUsers: s.users.all() },
      );
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, report);
      return {
        content: `Skrev ${path.relative(process.cwd(), target)} (${s.checks.length} krav, ${s.findings.length} funn). Status: ${runStatus(s.checks)}`,
      };
    },
  });

  return [sessionStatus, resetSession, writeReport];
}

function describeSession(s: Session): string {
  const users = s.users.all();
  const active = s.users.active?.alias;
  const lines = [
    `Miljø: ${s.config.env} · ${s.httpLog.length} kall · ${s.checks.length} krav · ${s.findings.length} funn`,
    `Testbrukere: ${users.map((u) => `${u.alias}${u.alias === active ? " (aktiv)" : ""} [${u.category}]`).join(", ") || "ingen"}`,
    `Opprettet i økten: ${s.owned.list().join(", ") || "ingenting"}`,
  ];
  if (s.checks.length) lines.push(`Status: ${runStatus(s.checks)}`);
  const last = s.httpLog.slice(-5).map((e) => `#${e.id} ${e.user} ${e.method} ${e.path} → ${e.status}`);
  if (last.length) lines.push("Siste kall:", ...last);
  return lines.join("\n");
}
