// Frontend-QA: finner PR-er i altinn-access-management-frontend og frontend-Features i altinn-auth som er klare for GUI-test.
//   - merget de siste LOOKBACK_DAYS dagene
//   - synlig ny funksjonalitet (ikke avhengigheter, refaktorering, tester, CI, Storybook)
//   - deployet til miljøet (vellykket kjøring av deploy-workflowen, ikke deployment-poster)
//   - ikke allerede testet (rapport finnes i reports/gui/<nøkkel>.md)
//   Først kommer nøkler fra reports/gui/retest.txt (én per linje, # er kommentar): allerede testede kandidater der
//   ⚪-kravene skal testes på nytt (`retest: true`).
//   Features: lukket de siste LOOKBACK_DAYS dagene, merket Frontend/area/access-management-frontend, alle sub-issues
//   lukket. API-agenten hopper over disse - de testes her.
// Skriver JSON-liste til stdout. Leser bare fra GitHub (gh), skriver ingenting dit.
//
//   node scripts/amf-candidates.mjs [at23] [maks]
import { existsSync, readFileSync } from "node:fs";
import { completedFeaturesSince, ghJson } from "./altinn.mjs";

const REPO = "Altinn/altinn-access-management-frontend";
const REPORT_DIR = "reports/gui";
const env = (process.argv[2] ?? "at23").toLowerCase();
const max = Number(process.argv[3] ?? 2);
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 7);
const FRONTEND_LABELS = ["Frontend", "area/access-management-frontend"];

// Kode som endrer det brukeren ser eller gjør.
const UI_CODE =
  /^(src\/(features|components|resources|rtk|routes|localizations|dataObjects)\/|backend\/src\/(?!.*Tests?\/))/;
// Titler som ikke er ny funksjonalitet.
const NOT_FEATURE =
  /^(chore|ci|build|docs|test|refactor|style)\b|^update (dependency|npm|nuget|github|node)|^playwright|^del \d+ playwright|^part \d+ of|unification plan|^prepare for|remove unused/i;

export function isUiFeature(pr) {
  if (NOT_FEATURE.test(pr.title.trim())) return false;
  return pr.files.some((f) => UI_CODE.test(f.path));
}

// Deployment-poster i AMF kan ikke brukes: Playwright-jobbene kjører med `environment: AT23/TT02` og lager egne
// poster. Derfor regnes bare vellykkede kjøringer av deploy-workflowene som deploy.
const DEPLOY_WORKFLOW = { at22: "deploy-at.yml", at23: "deploy-at.yml", tt02: "deploy-release.yml" };
let deployedShas;
function isDeployed(mergeSha) {
  deployedShas ??= (
    ghJson([
      "run",
      "list",
      "-R",
      REPO,
      "--workflow",
      DEPLOY_WORKFLOW[env],
      "--status",
      "success",
      "--limit",
      "10",
      "--json",
      "headSha",
    ]) ?? []
  ).map((r) => r.headSha);
  return deployedShas.some((sha) => {
    const cmp = ghJson(["api", `repos/${REPO}/compare/${mergeSha}...${sha}`]);
    return cmp.status === "ahead" || cmp.status === "identical";
  });
}

function alreadyTested(key) {
  return existsSync(`${REPORT_DIR}/${key}.md`);
}

const RETEST_FILE = `${REPORT_DIR}/retest.txt`;
const KEY_RE = /^(amf|feature)-(\d+)-(at22|at23|tt02)$/;

export function retestKeys(text, env) {
  return text
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter((k) => KEY_RE.test(k) && k.endsWith(`-${env}`));
}

function retestCandidate(key) {
  const [, kind, number] = key.match(KEY_RE);
  const src =
    kind === "amf"
      ? ghJson(["pr", "view", number, "-R", REPO, "--json", "title,url"])
      : ghJson(["issue", "view", number, "-R", "Altinn/altinn-auth", "--json", "title,url"]);
  return { kind: kind === "amf" ? "PR" : "Feature", key, number: Number(number), ...src, env, retest: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const prs =
    ghJson([
      "pr",
      "list",
      "-R",
      REPO,
      "--state",
      "merged",
      "--search",
      `merged:>=${since}`,
      "--limit",
      "100",
      "--json",
      "number,title,url,mergedAt,mergeCommit,files",
    ]) ?? [];

  const candidates = [];
  const retest = existsSync(RETEST_FILE) ? retestKeys(readFileSync(RETEST_FILE, "utf8"), env) : [];
  for (const key of retest) {
    if (candidates.length >= max) break;
    if (alreadyTested(key)) candidates.push(retestCandidate(key));
  }
  for (const pr of prs.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))) {
    if (candidates.length >= max) break;
    if (!isUiFeature(pr)) continue;
    const key = `amf-${pr.number}-${env}`;
    if (alreadyTested(key) || !isDeployed(pr.mergeCommit.oid)) continue;
    candidates.push({ kind: "PR", key, number: pr.number, title: pr.title, url: pr.url, env, mergedAt: pr.mergedAt });
  }

  // Lukket Feature = ferdig levert. Sub-issuene har ofte ingen lenket PR, så deploy kan ikke sjekkes herfra.
  for (const f of completedFeaturesSince(since)) {
    if (candidates.length >= max) break;
    if (f.state !== "CLOSED" || Date.parse(f.closedAt) < Date.parse(since)) continue;
    if (!f.labels.some((l) => FRONTEND_LABELS.includes(l))) continue;
    const key = `feature-${f.number}-${env}`;
    if (alreadyTested(key)) continue;
    candidates.push({ kind: "Feature", key, number: f.number, title: f.title, url: f.url, env, closedAt: f.closedAt });
  }
  console.log(JSON.stringify(candidates, null, 2));
}
