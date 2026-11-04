// Publiserer en lokal GUI-rapport (reports/gui/<nøkkel>.md) som issue i qa-repoet, i samme form som API-rapportene:
//   - én issue per nøkkel (amf-<pr>-<miljø> eller feature-<nr>-<miljø>), med statuslinje i issueteksten
//   - rapporten er ÉN kommentar som oppdateres ved ny kjøring
//   - skjermbilder lastes opp til grenen gui-rapporter (ikke main) og vises i rapporten
//
//   node scripts/publish-gui.mjs <nøkkel> [--dry-run]
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { gh, ghJson } from "./altinn.mjs";
import { noBacklink } from "./issue-text.mjs";
import { setStatus, triage, upsertReport } from "./publish.mjs";

const REPO = "Nyeng/altinn-qa-agent";
const DIR = "reports/gui";
const BRANCH = "gui-rapporter";
const LABELS = ["snoken", "gui"];
const KEY_RE = /^(amf|feature)-(\d+)-(at22|at23|tt02)$/;

const imageUrl = (file) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/gui/${file}`;

function ensureBranch() {
  if (ghJson(["api", `repos/${REPO}/branches`, "--jq", `[.[] | select(.name == "${BRANCH}")]`])?.length) return;
  const main = ghJson(["api", `repos/${REPO}/git/ref/heads/main`]).object.sha;
  gh(["api", "-X", "POST", `repos/${REPO}/git/refs`, "-f", `ref=refs/heads/${BRANCH}`, "-f", `sha=${main}`]);
}

// Eksisterende filer på grenen (sti → blob-sha), så uendrede bilder ikke lastes opp på nytt.
function remoteFiles() {
  const tree = ghJson(["api", `repos/${REPO}/git/trees/${BRANCH}?recursive=1`]).tree;
  return new Map(tree.map((t) => [t.path, t.sha]));
}

function uploadImage(file, remote) {
  const path = `gui/${file}`;
  const content = readFileSync(`${DIR}/${file}`);
  const localSha = createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
  const sha = remote.get(path);
  if (sha === localSha) return;
  const body = {
    message: `GUI-skjermbilde ${file}`,
    branch: BRANCH,
    content: content.toString("base64"),
    ...(sha ? { sha } : {}),
  };
  gh(["api", "-X", "PUT", `repos/${REPO}/contents/${path}`, "--input", "-"], JSON.stringify(body));
}

// Samme inndeling som API-rapportene (render.ts runStatus), talt fra punktlisten under Verifisert.
function status(report, env, testedAt) {
  const passed = (report.match(/^- [✅❌]/gmu) ?? []).length;
  const untested = (report.match(/^- ⚪/gmu) ?? []).length;
  const date = testedAt.toISOString().slice(0, 10);
  if (passed === 0) return `⚪ Ikke testet ${date} i ${env}`;
  if (untested > 0) return `🟡 Delvis testet (${passed} av ${passed + untested} krav) ${date} i ${env}`;
  return `✅ Testet ${date} i ${env}`;
}

function source(kind, number) {
  if (kind === "amf") {
    const pr = ghJson(["pr", "view", number, "-R", "Altinn/altinn-access-management-frontend", "--json", "title,url"]);
    return { ...pr, ref: `AMF#${number}`, kind: "PR" };
  }
  const issue = ghJson(["issue", "view", number, "-R", "Altinn/altinn-auth", "--json", "title,url"]);
  return { ...issue, ref: `altinn-auth#${number}`, kind: "Feature" };
}

function findIssue(key) {
  const marker = `<!-- gui-key:${key} -->`;
  const issues = ghJson([
    "issue",
    "list",
    "-R",
    REPO,
    "--label",
    "gui",
    "--state",
    "all",
    "--limit",
    "200",
    "--json",
    "number,body",
  ]);
  return issues.find((i) => i.body?.includes(marker))?.number;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [key, flag] = process.argv.slice(2);
  const dryRun = flag === "--dry-run";
  const match = key?.match(KEY_RE);
  if (!match) throw new Error("Bruk: node scripts/publish-gui.mjs <amf-<pr>-<miljø>|feature-<nr>-<miljø>>");
  const [, kind, number, env] = match;
  const reportPath = `${DIR}/${key}.md`;
  if (!existsSync(reportPath)) throw new Error(`Fant ikke ${reportPath}`);

  // Skjermbilder: filer som starter med nøkkelen.
  const images = readdirSync(DIR).filter((f) => f.startsWith(`${key}-`) && f.endsWith(".png"));
  let report = readFileSync(reportPath, "utf8").trim();
  for (const file of images) report = report.replaceAll(`${DIR}/${file}`, `[${file}](${imageUrl(file)})`);
  if (images.length) {
    report +=
      "\n\n<details><summary>Skjermbilder</summary>\n\n" +
      images.map((f) => `**${f}**\n\n![${f}](${imageUrl(f)})`).join("\n\n") +
      "\n\n</details>";
  }
  report += "\n\n<sub>Lokal frontend-QA (Claude Code, Playwright headless)</sub>";

  const src = source(kind, number);
  const title = `🖥️ GUI: ${src.title} (${src.ref} · ${env})`;
  if (dryRun) {
    console.log(
      `${title}\n${status(report, env, statSync(reportPath).mtime)}\nbilder: ${images.join(", ") || "ingen"}\n\n${report}`,
    );
    process.exit(0);
  }

  if (images.length) {
    ensureBranch();
    const remote = remoteFiles();
    for (const file of images) uploadImage(file, remote);
  }
  let issue = findIssue(key);
  if (!issue) {
    const body =
      `**Status:** ⏳\n\n**${src.kind}:** [${src.title}](${noBacklink(src.url)})\n\nGUI-test i ${env} (lokal frontend-QA).\n\n` +
      `<!-- gui-key:${key} -->`;
    const url = gh([
      "issue",
      "create",
      "-R",
      REPO,
      "--title",
      title,
      "--body",
      body,
      ...LABELS.flatMap((l) => ["--label", l]),
    ]);
    issue = Number(url.trim().split("/").pop());
  }
  upsertReport(issue, report);
  setStatus(issue, status(report, env, statSync(reportPath).mtime));
  // Bare nye funn holder issuen åpen: et funn merket «Kjent bug:» er allerede meldt i altinn-auth.
  triage(issue, (report.match(/^- 🐞(?!.*Kjent bug:).*$/gmu) ?? []).length);
  console.log(`https://github.com/${REPO}/issues/${issue}`);
}
