// Snoken-polling for Altinn/altinn-auth. Kjøres hver time i arbeidstiden av .github/workflows/snoken-polling.yml.
// Skriver aldri til altinn-auth: hver forespørsel blir en issue her (Nyeng/altinn-qa-agent), og rapporten havner der.
//
// 1. Registrer: nye "/snoken"-kommentarer fra godkjente brukere blir en issue med status «venter».
// 2. Klar til test? Gjelder forespørselen en PR, starter Snoken først når koden er ute i miljøet:
//    - PR-en må være merget (lukket uten merge → forespørselen avsluttes)
//    - registrerer appen deployments i GitHub (f.eks. access-management/at22): merge-commiten må være deployet
//    - ellers: merget for minst SNOKEN_DEPLOY_DELAY_MINUTES siden (deploy ikke bekreftet - står i rapporten)
//    Forespørsler på vanlige issues starter med en gang.
//
// Miljø: GH_TOKEN, GITHUB_REPOSITORY, SNOKEN_ALLOWED_USERS, SNOKEN_DEPLOY_DELAY_MINUTES, LOOKBACK_HOURS, DRY_RUN.
import { execFileSync } from "node:child_process";

const SOURCE_REPO = "Altinn/altinn-auth";
const OWN_REPO = process.env.GITHUB_REPOSITORY ?? "Nyeng/altinn-qa-agent";
const ALLOWED_USERS = (process.env.SNOKEN_ALLOWED_USERS ?? "Nyeng").split(",").map((u) => u.trim().toLowerCase());
const DEPLOY_DELAY_MINUTES = Number(process.env.SNOKEN_DEPLOY_DELAY_MINUTES || 10);
// Polling går bare i arbeidstiden, så første sjekk på mandag må se tilbake over helgen.
const LOOKBACK_HOURS = Number(process.env.LOOKBACK_HOURS ?? 72);
const GIVE_UP_HOURS = 7 * 24; // merget, men aldri sett deployet
const MAX_RUNS_PER_POLL = 3;
const LABEL = "snoken";
const WAITING = "snoken-venter";
const DRY_RUN = process.env.DRY_RUN === "true";

// Mappe i altinn-auth → navn på deployment-miljøet i GitHub (<app>/<miljø>).
const APPS = {
  "src/apps/Altinn.AccessManagement/": "access-management",
  "src/apps/Altinn.Authorization/": "authorization",
  "src/apps/Altinn.ResourceRegistry/": "resource-registry",
  "src/apps/Altinn.Register/": "register",
};

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 20e6 }).trim();
}
const ghJson = (args) => JSON.parse(gh(args) || "null");
const log = (msg) => console.log(DRY_RUN ? `[tørrkjøring] ${msg}` : msg);

// ── 1. Registrer nye forespørsler ────────────────────────────────────────────
// Nye issues er ikke alltid synlige i issue-lista med en gang, så de holdes også her.
const justCreated = [];

function registerRequests() {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();
  const comments = ghJson([
    "api", `repos/${SOURCE_REPO}/issues/comments?since=${since}&sort=created&direction=asc&per_page=100`, "--paginate", "--slurp",
  ]).flat();
  const requests = comments.filter(
    (c) => /(^|\s)\/snoken(\s|$)/.test(c.body ?? "") && ALLOWED_USERS.includes(c.user?.login?.toLowerCase()),
  );
  console.log(`${comments.length} kommentarer siden ${since}, ${requests.length} /snoken-forespørsler fra ${ALLOWED_USERS.join(", ")}`);

  for (const c of requests) {
    const existing = gh(["issue", "list", "-R", OWN_REPO, "--label", LABEL, "--state", "all", "--search", `${c.id} in:title`, "--json", "number", "--jq", "length"]);
    if (existing !== "0") continue;

    const number = c.issue_url.split("/").pop();
    const isPr = c.html_url.includes("/pull/");
    const after = c.body.slice(c.body.indexOf("/snoken") + "/snoken".length).trim();
    const envMatch = after.match(/^(at22|at23|tt02)\b/i);
    const req = {
      commentId: c.id,
      commentUrl: c.html_url,
      author: c.user.login,
      number,
      isPr,
      sourceUrl: `https://github.com/${SOURCE_REPO}/${isPr ? "pull" : "issues"}/${number}`,
      env: envMatch ? envMatch[1].toLowerCase() : "at23",
      charter: (envMatch ? after.slice(envMatch[0].length) : after).trim(),
    };
    req.maxSteps = req.charter.match(/\bmaks\s+(\d{1,2})\s+steg\b/i)?.[1];

    const body =
      `Forespørsel fra @${req.author} i ${req.commentUrl}\n\n**Miljø:** \`${req.env}\`\n\n` +
      `**Charter:**\n> ${req.charter.replaceAll("\n", "\n> ") || "(standard)"}\n\n` +
      (isPr ? "⏳ Venter til PR-en er merget og deployet til miljøet.\n\n" : "") +
      `<!-- snoken:${JSON.stringify(req)} -->`;
    if (DRY_RUN) {
      log(`ville registrert ${req.sourceUrl} (${req.env}): "${req.charter.slice(0, 60)}"`);
      continue;
    }
    const url = gh(["issue", "create", "-R", OWN_REPO, "--label", LABEL, "--label", WAITING,
      "--title", `🕵️ altinn-auth#${number} · ${req.env} · kommentar ${c.id}`, "--body", body]);
    justCreated.push({ number: Number(url.split("/").pop()), body, comments: [] });
    console.log(`Registrerte ${req.commentUrl}`);
  }
}

// ── 2. Start de som er klare ─────────────────────────────────────────────────
export function deploymentStatus(app, env, mergeSha) {
  const deployments = ghJson(["api", `repos/${SOURCE_REPO}/deployments?environment=${encodeURIComponent(`${app}/${env}`)}&per_page=10`]);
  if (!deployments?.length) return "ikke-sporet"; // appen registrerer ikke deployments i GitHub
  for (const d of deployments) {
    // altinn-auth registrerer deployments uten statuser. Da regnes den som ute DEPLOY_DELAY_MINUTES etter
    // at den ble registrert. Har den status, må den være success (failure/pending/in_progress teller ikke).
    const state = ghJson(["api", `repos/${SOURCE_REPO}/deployments/${d.id}/statuses?per_page=1`])?.[0]?.state;
    const minutesSinceDeploy = (Date.now() - Date.parse(d.created_at)) / 60_000;
    const done = state ? state === "success" : minutesSinceDeploy >= DEPLOY_DELAY_MINUTES;
    if (!done) continue;
    // Er merge-commiten med i det som er deployet?
    const cmp = ghJson(["api", `repos/${SOURCE_REPO}/compare/${mergeSha}...${d.sha}`]);
    return cmp.status === "ahead" || cmp.status === "identical" ? "deployet" : "ikke-deployet";
  }
  return "ikke-deployet";
}

export function readiness(req) {
  if (!req.isPr) return { ready: true };
  const pr = ghJson(["pr", "view", req.number, "-R", SOURCE_REPO, "--json", "state,mergedAt,mergeCommit,files"]);
  if (pr.state === "CLOSED") return { done: "PR-en ble lukket uten merge - forespørselen avsluttes." };
  if (!pr.mergedAt) return { waiting: "PR-en er ikke merget ennå." };

  const minutesSinceMerge = (Date.now() - Date.parse(pr.mergedAt)) / 60_000;
  const apps = [...new Set(pr.files.flatMap((f) => Object.entries(APPS).filter(([dir]) => f.path.startsWith(dir)).map(([, a]) => a)))];
  const statuses = apps.map((app) => ({ app, status: deploymentStatus(app, req.env, pr.mergeCommit.oid) }));

  if (statuses.some((s) => s.status === "ikke-deployet")) {
    if (minutesSinceMerge > GIVE_UP_HOURS * 60) return { done: `Merget for over ${GIVE_UP_HOURS / 24} dager siden, men aldri sett deployet til ${req.env}.` };
    return { waiting: `Merget, men ikke deployet ennå: ${statuses.filter((s) => s.status === "ikke-deployet").map((s) => `${s.app}/${req.env}`).join(", ")}.` };
  }
  const untracked = statuses.filter((s) => s.status === "ikke-sporet").map((s) => s.app);
  if ((untracked.length || !apps.length) && minutesSinceMerge < DEPLOY_DELAY_MINUTES) {
    return { waiting: `Merget for ${Math.round(minutesSinceMerge)} min siden - venter minst ${DEPLOY_DELAY_MINUTES} min på deploy.` };
  }
  const note = untracked.length || !apps.length
    ? `Deploy kunne ikke bekreftes (${untracked.join(", ") || "ukjent app"} registrerer ikke deployments i GitHub) - startet ${Math.round(minutesSinceMerge)} min etter merge.`
    : `Deploy bekreftet: ${statuses.map((s) => `${s.app}/${req.env}`).join(", ")}.`;
  return { ready: true, note };
}

function startReady() {
  const listed = ghJson(["issue", "list", "-R", OWN_REPO, "--label", WAITING, "--state", "open", "--json", "number,body,comments"]) ?? [];
  const waiting = [...listed, ...justCreated.filter((n) => !listed.some((l) => l.number === n.number))];
  let started = 0;
  for (const issue of waiting) {
    const meta = issue.body.match(/<!-- snoken:(.*) -->/)?.[1];
    if (!meta) continue;
    const req = JSON.parse(meta);
    const r = readiness(req);

    if (r.done) {
      log(`#${issue.number}: ${r.done}`);
      if (!DRY_RUN) {
        gh(["issue", "comment", String(issue.number), "-R", OWN_REPO, "--body", `⏹️ ${r.done}`]);
        gh(["issue", "close", String(issue.number), "-R", OWN_REPO]);
      }
      continue;
    }
    if (r.waiting) {
      log(`#${issue.number}: ⏳ ${r.waiting}`);
      // Kommenter bare når statusen endrer seg, så issuen ikke fylles med like meldinger.
      const last = issue.comments?.at(-1)?.body ?? "";
      if (!DRY_RUN && !last.includes(r.waiting)) gh(["issue", "comment", String(issue.number), "-R", OWN_REPO, "--body", `⏳ ${r.waiting}`]);
      continue;
    }
    if (started >= MAX_RUNS_PER_POLL) {
      log(`Nådde maks ${MAX_RUNS_PER_POLL} økter - resten tas neste time.`);
      break;
    }

    const charter = [req.charter, r.note && `\n\n(${r.note})`].filter(Boolean).join("");
    const runArgs = ["workflow", "run", "snoken.yml", "-R", OWN_REPO, "-f", `env=${req.env}`, "-f", `charter=${charter}`, "-f", `issue=${issue.number}`];
    if (req.isPr) runArgs.push("-f", `pr=${req.sourceUrl}`);
    if (req.maxSteps) runArgs.push("-f", `max_steps=${req.maxSteps}`);
    log(`#${issue.number}: ▶️ starter Snoken (${req.env}). ${r.note ?? ""}`);
    if (!DRY_RUN) {
      gh(runArgs);
      gh(["issue", "edit", String(issue.number), "-R", OWN_REPO, "--remove-label", WAITING]);
      gh(["issue", "comment", String(issue.number), "-R", OWN_REPO, "--body", `▶️ Snoken er startet. ${r.note ?? ""}`]);
    }
    started++;
  }
}

// Kjøres som skript (ikke når readiness/deploymentStatus importeres i test).
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!DRY_RUN) {
    gh(["label", "create", LABEL, "-R", OWN_REPO, "--color", "5319e7", "--description", "Snoken-forespørsel fra altinn-auth", "--force"]);
    gh(["label", "create", WAITING, "-R", OWN_REPO, "--color", "fbca04", "--description", "Venter på merge/deploy", "--force"]);
  }
  registerRequests();
  startReady();
}
