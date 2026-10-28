// Ser etter nye "/snoken"-kommentarer i Altinn/altinn-auth og starter Snoken for dem.
// Kjøres hver time av .github/workflows/snoken-polling.yml. Skriver aldri til altinn-auth:
// hver forespørsel blir en issue her (Nyeng/altinn-qa-agent), og rapporten havner der.
//
// Leser fra miljøet: GH_TOKEN, GITHUB_REPOSITORY, SNOKEN_ALLOWED_USERS (kommaseparert), LOOKBACK_HOURS.
import { execFileSync } from "node:child_process";

const SOURCE_REPO = "Altinn/altinn-auth";
const OWN_REPO = process.env.GITHUB_REPOSITORY ?? "Nyeng/altinn-qa-agent";
const ALLOWED_USERS = (process.env.SNOKEN_ALLOWED_USERS ?? "Nyeng").split(",").map((u) => u.trim().toLowerCase());
// Polling går bare i arbeidstiden, så første sjekk på mandag må se tilbake over helgen.
// Duplikater fanges av issue-sjekken, så overlapp er ufarlig.
const LOOKBACK_HOURS = Number(process.env.LOOKBACK_HOURS ?? 72);
const MAX_RUNS_PER_POLL = 3;
const LABEL = "snoken";
// DRY_RUN=true: bare les og vis hva som ville skjedd (ingen issues, ingen kjøringer).
const DRY_RUN = process.env.DRY_RUN === "true";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 20e6 }).trim();
}

const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();
// Kommentarer på både issues og PR-er (samtale-fanen) i altinn-auth, nyeste sist.
const comments = JSON.parse(
  gh(["api", `repos/${SOURCE_REPO}/issues/comments?since=${since}&sort=created&direction=asc&per_page=100`, "--paginate", "--slurp"]),
).flat();

const requests = comments.filter(
  (c) => /(^|\s)\/snoken(\s|$)/.test(c.body ?? "") && ALLOWED_USERS.includes(c.user?.login?.toLowerCase()),
);
console.log(`${comments.length} kommentarer siden ${since}, ${requests.length} /snoken-forespørsler fra ${ALLOWED_USERS.join(", ")}`);

if (!DRY_RUN) gh(["label", "create", LABEL, "-R", OWN_REPO, "--color", "5319e7", "--description", "Snoken-forespørsel fra altinn-auth", "--force"]);

let started = 0;
for (const c of requests) {
  if (started >= MAX_RUNS_PER_POLL) {
    console.log(`Nådde maks ${MAX_RUNS_PER_POLL} økter for denne runden - resten tas neste time.`);
    break;
  }

  // Allerede behandlet? Kommentar-ID-en står i issue-tittelen.
  const existing = gh(["issue", "list", "-R", OWN_REPO, "--label", LABEL, "--state", "all", "--search", `${c.id} in:title`, "--json", "number", "--jq", "length"]);
  if (existing !== "0") continue;

  const number = c.issue_url.split("/").pop();
  const isPr = c.html_url.includes("/pull/");
  const sourceUrl = `https://github.com/${SOURCE_REPO}/${isPr ? "pull" : "issues"}/${number}`;

  const after = c.body.slice(c.body.indexOf("/snoken") + "/snoken".length).trim();
  const envMatch = after.match(/^(at22|at23|tt02)\b/i);
  const env = envMatch ? envMatch[1].toLowerCase() : "at23";
  const charter = (envMatch ? after.slice(envMatch[0].length) : after).trim();
  const stepsMatch = charter.match(/\bmaks\s+(\d{1,2})\s+steg\b/i);

  if (DRY_RUN) {
    console.log(`[tørrkjøring] ville startet Snoken: env=${env}, pr=${isPr ? sourceUrl : "-"}, charter="${charter.slice(0, 80)}"`);
    started++;
    continue;
  }

  const issueUrl = gh([
    "issue", "create", "-R", OWN_REPO, "--label", LABEL,
    "--title", `🕵️ ${SOURCE_REPO.split("/")[1]}#${number} · ${env} · kommentar ${c.id}`,
    "--body",
    `Forespørsel fra @${c.user.login} i ${c.html_url}\n\n**Miljø:** \`${env}\`\n\n**Charter:**\n> ${charter.replaceAll("\n", "\n> ") || "(standard)"}\n\nSnoken svarer her når økten er ferdig.`,
  ]);
  const issueNumber = issueUrl.split("/").pop();

  const runArgs = ["workflow", "run", "snoken.yml", "-R", OWN_REPO, "-f", `env=${env}`, "-f", `charter=${charter}`, "-f", `issue=${issueNumber}`];
  if (isPr) runArgs.push("-f", `pr=${sourceUrl}`);
  if (stepsMatch) runArgs.push("-f", `max_steps=${stepsMatch[1]}`);
  gh(runArgs);

  console.log(`Startet Snoken for ${c.html_url} → ${issueUrl}`);
  started++;
}
