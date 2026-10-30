// Frontend-QA: finner PR-er i altinn-access-management-frontend som er klare for GUI-test.
//   - merget de siste LOOKBACK_DAYS dagene
//   - synlig ny funksjonalitet (ikke avhengigheter, refaktorering, tester, CI, Storybook)
//   - deployet til miljøet (vellykket kjøring av deploy-workflowen, ikke deployment-poster)
//   - ikke allerede testet (rapport finnes i reports/gui/<nøkkel>.md)
// Skriver JSON-liste til stdout. Leser bare fra GitHub (gh), skriver ingenting dit.
//
//   node scripts/amf-candidates.mjs [at23] [maks]
import { existsSync } from "node:fs";
import { ghJson } from "./altinn.mjs";

const REPO = "Altinn/altinn-access-management-frontend";
const REPORT_DIR = "reports/gui";
const env = (process.argv[2] ?? "at23").toLowerCase();
const max = Number(process.argv[3] ?? 2);
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 7);

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
  for (const pr of prs.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))) {
    if (candidates.length >= max) break;
    if (!isUiFeature(pr)) continue;
    const key = `amf-${pr.number}-${env}`;
    if (alreadyTested(key) || !isDeployed(pr.mergeCommit.oid)) continue;
    candidates.push({ key, number: pr.number, title: pr.title, url: pr.url, env, mergedAt: pr.mergedAt });
  }
  console.log(JSON.stringify(candidates, null, 2));
}
