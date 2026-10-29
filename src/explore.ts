// Kjører én testøkt: les charter → kjør agenten → skriv rapport.
// Bruk: npm run explore -- --env=at22 charters/<fil>.md
import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAgent, type AgentEvent } from "./agent/loop.js";
import { systemPrompt } from "./agent/prompt.js";
import { Session } from "./agent/session.js";
import { loadConfig } from "./config.js";
import { renderReport } from "./report/render.js";
import { createTools } from "./tools/index.js";

const charterPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!charterPath) {
  console.error("Bruk: npm run explore -- --env=at22 charters/<charter>.md");
  process.exit(1);
}

const config = loadConfig();
const session = new Session(config);
const charter = await readFile(charterPath, "utf8");
const started = new Date();
console.log(
  `🕵️ Son of Vegard starter økt i ${config.env} (API-er: ${Object.keys(config.apis).join(", ")}) ` +
    `med ${config.model} (maks ${config.maxSteps} steg)\n`,
);

const result = await runAgent({
  client: new Anthropic().beta.messages,
  session,
  tools: createTools(session),
  system: systemPrompt(config, session.users.categories()),
  charter,
  onEvent: printEvent,
});

// Overskrift (f.eks. "PR #4613") skrives av charter-skriptet i CI, hvis den finnes.
const titleFile = path.join(path.dirname(charterPath), "title.txt");
const title = existsSync(titleFile) ? (await readFile(titleFile, "utf8")).trim() || undefined : undefined;
const report = renderReport(result, { env: config.env, model: config.model, title, runUrl: process.env.QA_RUN_URL });

await mkdir("reports", { recursive: true });
const name = `${started.toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${config.env}-${path.basename(charterPath, ".md")}.md`;
await writeFile(path.join("reports", name), report);
// Fast filnavn så CI kan poste rapporten, og alle detaljer (dekning, hele HTTP-loggen) til artefakten.
await writeFile(path.join("reports", "latest.md"), report);
await writeFile(
  path.join("reports", "session.json"),
  JSON.stringify({ env: config.env, model: config.model, ...result }, null, 2),
);

console.log(
  `\n📄 Rapport: reports/${name}  ·  ${result.checks.length} krav, ${result.findings.length} funn` +
    `  ·  ca. $${result.costUsd.toFixed(2)}`,
);

function printEvent(event: AgentEvent) {
  if (event.type === "text") console.log(`\n🕵️ ${event.text}`);
  else if (event.type === "tool") console.log(`${event.isError ? "⚠️ " : "→ "} ${event.label}`);
  else console.log(`\n⏱️  Tidsboksen er brukt opp (${event.reason}).`);
}
