import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runSession } from "./agent.js";
import { config } from "./config.js";
import { renderReport } from "./report.js";

// Bruk: npm run explore -- --env=at22 charters/<fil>.md
const charterPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!charterPath) {
  console.error("Bruk: npm run explore -- --env=at22 charters/<charter>.md");
  process.exit(1);
}

const charter = await readFile(charterPath, "utf8");
const started = new Date();
console.log(`🔎 Starter økt i ${config.env} mot ${config.target.baseUrl.origin}${config.target.appPath} med ${config.model} (maks ${config.maxSteps} steg)\n`);

const result = await runSession(charter);

const name = `${started.toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${config.env}-${path.basename(charterPath, ".md")}.md`;
await mkdir("reports", { recursive: true });
const report = renderReport(charter, result, { model: config.model, env: config.env, started });
await writeFile(path.join("reports", name), report);
// Fast filnavn så CI (GitHub Action) kan poste rapporten som kommentar.
await writeFile(path.join("reports", "latest.md"), report);

console.log(`\n📄 Rapport: reports/${name}  ·  ${result.findings.length} funn, ${result.notes.length} notater`);
