import { existsSync } from "node:fs";
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
console.log(`🕵️ Snoken starter økt i ${config.env} (API-er: ${Object.keys(config.target.apis).join(", ")}) med ${config.model} (maks ${config.maxSteps} steg)\n`);

const result = await runSession(charter);

const name = `${started.toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${config.env}-${path.basename(charterPath, ".md")}.md`;
await mkdir("reports", { recursive: true });
// Overskrift (f.eks. "PR #4613") skrives av charter-skriptet i CI, hvis den finnes.
const titleFile = path.join(path.dirname(charterPath), "title.txt");
const title = existsSync(titleFile) ? (await readFile(titleFile, "utf8")).trim() || undefined : undefined;
const report = renderReport(result, { env: config.env, title });
await writeFile(path.join("reports", name), report);
// Alle detaljer (dekning per krav, hele HTTP-loggen) til artefakten - ikke i den korte rapporten.
await writeFile(path.join("reports", "session.json"), JSON.stringify({ env: config.env, model: config.model, ...result }, null, 2));
// Fast filnavn så CI (GitHub Action) kan poste rapporten som kommentar.
await writeFile(path.join("reports", "latest.md"), report);

console.log(
  `\n📄 Rapport: reports/${name}  ·  ${result.checks.length} krav, ${result.findings.length} funn` +
    `  ·  ca. $${result.costUsd.toFixed(2)}`,
);
