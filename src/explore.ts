import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runSession } from "./agent.js";
import { config } from "./config.js";
import { renderReport } from "./report.js";

// Bruk: npm run explore -- charters/<fil>.md
const charterPath = process.argv[2];
if (!charterPath) {
  console.error("Bruk: npm run explore -- charters/<charter>.md");
  process.exit(1);
}

const charter = await readFile(charterPath, "utf8");
const started = new Date();
console.log(`🔎 Starter økt mot ${config.target.baseUrl.origin} med ${config.model} (maks ${config.maxSteps} steg)\n`);

const result = await runSession(charter);

const name = `${started.toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${path.basename(charterPath, ".md")}.md`;
await mkdir("reports", { recursive: true });
await writeFile(path.join("reports", name), renderReport(charter, result, { model: config.model, started }));

console.log(`\n📄 Rapport: reports/${name}  ·  ${result.findings.length} funn, ${result.notes.length} notater`);
