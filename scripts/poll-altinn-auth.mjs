// Son of Vegard-polling for Altinn/altinn-auth. Kjøres hver time i arbeidstiden av .github/workflows/snoken-polling.yml.
// Skriver aldri til altinn-auth: hver forespørsel blir en issue her (Nyeng/altinn-qa-agent), og rapporten havner der.
//
// 1. Registrer forespørsler (hver blir en issue her med status «venter»):
//    a) manuelt: "/snoken"-kommentarer fra godkjente brukere
//    b) automatisk: mergede PR-er som er testbare (🟢 funksjonell / 🟡 bak flagg), i SNOKEN_AUTO_ENV (at22)
//    c) automatisk: Features der alle sub-issues er lukket - test av hele Featuren mot akseptansekriteriene
// 2. Klar til test? Gjelder forespørselen en PR, starter Son of Vegard først når koden er ute i miljøet:
//    - PR-en må være merget (lukket uten merge → forespørselen avsluttes)
//    - registrerer appen deployments i GitHub (f.eks. access-management/at22): merge-commiten må være deployet
//    - ellers: merget for minst SNOKEN_DEPLOY_DELAY_MINUTES siden (deploy ikke bekreftet - står i rapporten)
//    Forespørsler på vanlige issues starter med en gang.
//
//    Features venter til alle PR-ene som lukket sub-issuene er deployet.
// 3. Maks SNOKEN_DAILY_MAX økter per dag totalt (resten venter til neste dag).
//
// Miljø: GH_TOKEN, GITHUB_REPOSITORY, SNOKEN_ALLOWED_USERS, SNOKEN_DEPLOY_DELAY_MINUTES, SNOKEN_AUTO_ENV,
//        SNOKEN_DAILY_MAX, SNOKEN_AUTO (false = slå av automatikken), LOOKBACK_HOURS, DRY_RUN.
import {
  closingIssues,
  completedFeaturesSince,
  featureDetails,
  featureOf,
  gh,
  ghJson,
  SOURCE_REPO,
} from "./altinn.mjs";
import { CATEGORIES, classify, isRuntimeCode } from "./pr-testability.mjs";
import { setStatus } from "./publish.mjs";

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
const AUTO = process.env.SNOKEN_AUTO !== "false";
const AUTO_ENV = process.env.SNOKEN_AUTO_ENV || "at22";
const AUTO_CATEGORIES = ["funksjonell", "bak-flagg"];
const DAILY_MAX = Number(process.env.SNOKEN_DAILY_MAX || 5);
// PR-er som ikke skal testes automatisk (vurdert manuelt), f.eks. "4725,4726".
const SKIP_PRS = new Set(
  (process.env.SNOKEN_SKIP_PRS ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean),
);
// Store endringer får større budsjett. Måles på kjørende kode, ikke tester.
const LARGE_PR = { runtimeFiles: 8, runtimeLines: 300 };
const STEPS_NORMAL = 25;
const STEPS_LARGE = 40;

// Mappe i altinn-auth → navn på deployment-miljøet i GitHub (<app>/<miljø>).
const APPS = {
  "src/apps/Altinn.AccessManagement/": "access-management",
  "src/apps/Altinn.Authorization/": "authorization",
  "src/apps/Altinn.ResourceRegistry/": "resource-registry",
  "src/apps/Altinn.Register/": "register",
};

const log = (msg) => console.log(DRY_RUN ? `[tørrkjøring] ${msg}` : msg);

// ── 1. Registrer nye forespørsler ────────────────────────────────────────────
// Nye issues er ikke alltid synlige i issue-lista med en gang, så de holdes også her.
const justCreated = [];

// Nøkkel i issueteksten hindrer at samme PR/Feature registreres to ganger.
const createdKeys = new Set();
// `titleRef` (f.eks. "altinn-auth#4613 · at22") fanger også manuelle /snoken-forespørsler for samme PR og miljø.
function alreadyRegistered(key, titleRef) {
  if (createdKeys.has(key)) return true;
  const count = (q) =>
    gh([
      "issue",
      "list",
      "-R",
      OWN_REPO,
      "--label",
      LABEL,
      "--state",
      "all",
      "--search",
      q,
      "--json",
      "number",
      "--jq",
      "length",
    ]);
  return count(`"${key}" in:body`) !== "0" || (titleRef && count(`"${titleRef}" in:title`) !== "0");
}

function createRequestIssue({ title, status, intro, req, key }) {
  const body = `**Status:** ${status}\n\n${intro}\n\n<!-- snoken-key:${key} -->\n<!-- snoken:${JSON.stringify(req)} -->`;
  createdKeys.add(key);
  if (DRY_RUN) {
    log(`ville registrert: ${title}`);
    return;
  }
  const url = gh([
    "issue",
    "create",
    "-R",
    OWN_REPO,
    "--label",
    LABEL,
    "--label",
    WAITING,
    "--title",
    title,
    "--body",
    body,
  ]);
  justCreated.push({ number: Number(url.split("/").pop()), body, comments: [] });
  console.log(`Registrerte ${title} → ${url}`);
}

// Automatisk: testbare PR-er merget i perioden.
function registerAutoPullRequests(since) {
  const prs =
    ghJson([
      "pr",
      "list",
      "-R",
      SOURCE_REPO,
      "--state",
      "merged",
      "--search",
      `merged:>=${since.slice(0, 10)}`,
      "--limit",
      "100",
      "--json",
      "number,title,url,files",
    ]) ?? [];
  let n = 0;
  for (const pr of prs) {
    if (SKIP_PRS.has(String(pr.number))) continue;
    const c = classify({ title: pr.title, files: pr.files.map((f) => f.path) });
    if (!AUTO_CATEGORIES.includes(c.category)) continue;
    const key = `auto-pr-${pr.number}-${AUTO_ENV}`;
    if (alreadyRegistered(key, `altinn-auth#${pr.number} · ${AUTO_ENV}`)) continue;
    const feature = closingIssues(pr.number)
      .map((i) => featureOf(i.number))
      .find(Boolean);
    const runtime = pr.files.filter((f) => isRuntimeCode(f.path));
    const runtimeLines = runtime.reduce((sum, f) => sum + (f.additions ?? 0) + (f.deletions ?? 0), 0);
    const large = runtime.length >= LARGE_PR.runtimeFiles || runtimeLines >= LARGE_PR.runtimeLines;
    const req = {
      auto: true,
      isPr: true,
      maxSteps: String(large ? STEPS_LARGE : STEPS_NORMAL),
      number: String(pr.number),
      env: AUTO_ENV,
      sourceUrl: pr.url,
      charter: "",
      feature: feature?.number,
    };
    createRequestIssue({
      key,
      req,
      title: `🕵️ altinn-auth#${pr.number} · ${AUTO_ENV} · ${CATEGORIES[c.category].icon} ${pr.title.slice(0, 60)}`,
      status: "⏳ Venter på deploy",
      intro: `Automatisk test av ${pr.url}` + (feature ? ` (Feature #${feature.number}: ${feature.title})` : ""),
    });
    n++;
  }
  console.log(`${prs.length} PR-er merget siden ${since.slice(0, 10)}, ${n} nye testbare registrert`);
}

// Automatisk: Features der alle sub-issues er lukket.
function registerCompletedFeatures(since) {
  const features = completedFeaturesSince(since);
  let n = 0;
  for (const f of features) {
    const key = `auto-feature-${f.number}-${AUTO_ENV}`;
    if (alreadyRegistered(key, `Feature altinn-auth#${f.number} · ${AUTO_ENV}`)) continue;
    const req = { auto: true, isFeature: true, number: String(f.number), env: AUTO_ENV, sourceUrl: f.url, charter: "" };
    createRequestIssue({
      key,
      req,
      title: `🕵️ Feature altinn-auth#${f.number} · ${AUTO_ENV} · ${f.title.slice(0, 60)}`,
      status: "⏳ Venter på deploy av alle PR-er",
      intro: `Automatisk test av hele Featuren ${f.url} (alle ${f.subIssuesSummary.total} sub-issues lukket)`,
    });
    n++;
  }
  console.log(`${features.length} komplette Features oppdatert siden ${since.slice(0, 10)}, ${n} nye registrert`);
}

function registerRequests() {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();
  const comments = ghJson([
    "api",
    `repos/${SOURCE_REPO}/issues/comments?since=${since}&sort=created&direction=asc&per_page=100`,
    "--paginate",
    "--slurp",
  ]).flat();
  const requests = comments.filter(
    (c) => /(^|\s)\/snoken(\s|$)/.test(c.body ?? "") && ALLOWED_USERS.includes(c.user?.login?.toLowerCase()),
  );
  console.log(
    `${comments.length} kommentarer siden ${since}, ${requests.length} /snoken-forespørsler fra ${ALLOWED_USERS.join(", ")}`,
  );

  for (const c of requests) {
    const existing = gh([
      "issue",
      "list",
      "-R",
      OWN_REPO,
      "--label",
      LABEL,
      "--state",
      "all",
      "--search",
      `${c.id} in:title`,
      "--json",
      "number",
      "--jq",
      "length",
    ]);
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
    // "tving" eller "kategori:<navn>" kjører også PR-er som ellers regnes som ikke testbare.
    req.force = /\btving\b|\bkategori:/i.test(req.charter);

    // Issuen er bare forespørselen + én statuslinje; rapporten kommer som én kommentar (scripts/publish.mjs).
    const body =
      `**Status:** ${isPr ? "⏳ Venter på merge og deploy" : "⏳ Venter"}\n\n` +
      `Forespørsel fra @${req.author}: ${req.commentUrl}\n\n**Miljø:** \`${req.env}\`\n\n` +
      `> ${req.charter.replaceAll("\n", "\n> ") || "(standard)"}\n\n` +
      `<!-- snoken:${JSON.stringify(req)} -->`;
    if (DRY_RUN) {
      log(`ville registrert ${req.sourceUrl} (${req.env}): "${req.charter.slice(0, 60)}"`);
      continue;
    }
    const url = gh([
      "issue",
      "create",
      "-R",
      OWN_REPO,
      "--label",
      LABEL,
      "--label",
      WAITING,
      "--title",
      `🕵️ altinn-auth#${number} · ${req.env} · kommentar ${c.id}`,
      "--body",
      body,
    ]);
    justCreated.push({ number: Number(url.split("/").pop()), body, comments: [] });
    console.log(`Registrerte ${req.commentUrl}`);
  }
}

// ── 2. Start de som er klare ─────────────────────────────────────────────────
export function deploymentStatus(app, env, mergeSha) {
  const deployments = ghJson([
    "api",
    `repos/${SOURCE_REPO}/deployments?environment=${encodeURIComponent(`${app}/${env}`)}&per_page=10`,
  ]);
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
  if (req.isFeature) return featureReadiness(req);
  if (!req.isPr) return { ready: true };
  const pr = ghJson(["pr", "view", req.number, "-R", SOURCE_REPO, "--json", "title,state,mergedAt,mergeCommit,files"]);
  const testability = classify({ title: pr.title, files: pr.files.map((f) => f.path) });
  const category = CATEGORIES[testability.category];
  if (!category.run && !req.force) {
    return {
      done:
        `${category.icon} ${category.name} - kjøres ikke: ${testability.reason}` +
        `${category.skipReason ? ` (${category.skipReason})` : ""} ` +
        `Skriv \`/snoken ${req.env} tving …\` på PR-en for å kjøre likevel.`,
    };
  }
  if (pr.state === "CLOSED") return { done: "PR-en ble lukket uten merge - forespørselen avsluttes." };
  if (!pr.mergedAt) return { waiting: "PR-en er ikke merget ennå." };

  const minutesSinceMerge = (Date.now() - Date.parse(pr.mergedAt)) / 60_000;
  const apps = [
    ...new Set(
      pr.files.flatMap((f) =>
        Object.entries(APPS)
          .filter(([dir]) => f.path.startsWith(dir))
          .map(([, a]) => a),
      ),
    ),
  ];
  const statuses = apps.map((app) => ({ app, status: deploymentStatus(app, req.env, pr.mergeCommit.oid) }));

  if (statuses.some((s) => s.status === "ikke-deployet")) {
    if (minutesSinceMerge > GIVE_UP_HOURS * 60)
      return { done: `Merget for over ${GIVE_UP_HOURS / 24} dager siden, men aldri sett deployet til ${req.env}.` };
    return {
      waiting: `Merget, men ikke deployet ennå: ${statuses
        .filter((s) => s.status === "ikke-deployet")
        .map((s) => `${s.app}/${req.env}`)
        .join(", ")}.`,
    };
  }
  const untracked = statuses.filter((s) => s.status === "ikke-sporet").map((s) => s.app);
  if ((untracked.length || !apps.length) && minutesSinceMerge < DEPLOY_DELAY_MINUTES) {
    return {
      waiting: `Merget for ${Math.round(minutesSinceMerge)} min siden - venter minst ${DEPLOY_DELAY_MINUTES} min på deploy.`,
    };
  }
  const note =
    untracked.length || !apps.length
      ? `Deploy ikke bekreftet (${untracked.join(", ") || "ukjent app"} sporer ikke deploy i GitHub).`
      : `Deploy bekreftet (${statuses.map((s) => `${s.app}/${req.env}`).join(", ")}).`;
  return { ready: true, note };
}

// En Feature er klar når alle PR-ene (i altinn-auth) som lukket sub-issuene er deployet.
function featureReadiness(req) {
  const f = featureDetails(req.number);
  const done = f.subIssues.filter((s) => s.state === "CLOSED" && s.stateReason !== "NOT_PLANNED");
  if (f.subIssues.some((s) => s.state === "OPEN")) return { waiting: "Featuren har fortsatt åpne sub-issues." };
  const prs = done.filter((s) => s.pr).map((s) => s.pr);
  const pending = [];
  for (const pr of prs) {
    const r = readiness({ isPr: true, number: String(pr), env: req.env, force: true });
    if (r.waiting) pending.push(`#${pr}`);
  }
  if (pending.length) return { waiting: `Venter på deploy av ${pending.join(", ")}.` };
  const external = done.filter((s) => s.externalPr).map((s) => s.externalPr);
  const withoutPr = done.filter((s) => !s.pr && !s.externalPr).map((s) => `#${s.number}`);
  const note = [
    prs.length ? `${prs.length} PR-er deployet` : "ingen PR-er i altinn-auth",
    external.length && `utenfor altinn-auth: ${external.join(", ")}`,
    withoutPr.length && `lukket uten PR: ${withoutPr.join(", ")}`,
  ]
    .filter(Boolean)
    .join("; ");
  return { ready: true, note: `${note}.` };
}

// Økter startet i dag (alle kilder), for dagstaket.
function runsToday() {
  const today = new Date().toISOString().slice(0, 10);
  return Number(
    gh([
      "run",
      "list",
      "-R",
      OWN_REPO,
      "--workflow",
      "snoken.yml",
      "--event",
      "workflow_dispatch",
      "--created",
      `>=${today}`,
      "--limit",
      "100",
      "--json",
      "databaseId",
      "--jq",
      "length",
    ]) || 0,
  );
}

function startReady() {
  const listed =
    ghJson([
      "issue",
      "list",
      "-R",
      OWN_REPO,
      "--label",
      WAITING,
      "--state",
      "open",
      "--json",
      "number,body,comments",
    ]) ?? [];
  const waiting = [...listed, ...justCreated.filter((n) => !listed.some((l) => l.number === n.number))];
  let started = 0;
  const alreadyToday = runsToday();
  for (const issue of waiting) {
    const meta = issue.body.match(/<!-- snoken:(.*) -->/)?.[1];
    if (!meta) continue;
    const req = JSON.parse(meta);
    const r = readiness(req);

    if (r.done) {
      log(`#${issue.number}: ${r.done}`);
      if (!DRY_RUN) {
        setStatus(issue.number, /^[⚪🔵]/u.test(r.done) ? r.done : `⏹️ ${r.done}`);
        gh(["issue", "close", String(issue.number), "-R", OWN_REPO]);
      }
      continue;
    }
    if (r.waiting) {
      log(`#${issue.number}: ⏳ ${r.waiting}`);
      if (!DRY_RUN) setStatus(issue.number, `⏳ ${r.waiting}`);
      continue;
    }
    if (alreadyToday + started >= DAILY_MAX) {
      log(`#${issue.number}: dagstaket på ${DAILY_MAX} økter er nådd`);
      if (!DRY_RUN)
        setStatus(issue.number, `⏳ Klar, men dagstaket på ${DAILY_MAX} økter er nådd - kjøres neste arbeidsdag.`);
      continue;
    }
    if (started >= MAX_RUNS_PER_POLL) {
      log(`Nådde maks ${MAX_RUNS_PER_POLL} økter - resten tas neste time.`);
      break;
    }

    const charter = [req.charter, r.note && `\n\n(${r.note})`].filter(Boolean).join("");
    const runArgs = [
      "workflow",
      "run",
      "snoken.yml",
      "-R",
      OWN_REPO,
      "-f",
      `env=${req.env}`,
      "-f",
      `charter=${charter}`,
      "-f",
      `issue=${issue.number}`,
    ];
    if (req.isPr) runArgs.push("-f", `pr=${req.sourceUrl}`);
    if (req.isFeature) runArgs.push("-f", `feature=${req.sourceUrl}`);
    if (req.maxSteps) runArgs.push("-f", `max_steps=${req.maxSteps}`);
    log(`#${issue.number}: ▶️ starter Son of Vegard (${req.env}). ${r.note ?? ""}`);
    if (!DRY_RUN) {
      gh(runArgs);
      gh(["issue", "edit", String(issue.number), "-R", OWN_REPO, "--remove-label", WAITING]);
      setStatus(issue.number, `▶️ Kjører. ${r.note ?? ""}`.trim());
    }
    started++;
  }
}

// Kjøres som skript (ikke når readiness/deploymentStatus importeres i test).
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!DRY_RUN) {
    gh([
      "label",
      "create",
      LABEL,
      "-R",
      OWN_REPO,
      "--color",
      "5319e7",
      "--description",
      "Son of Vegard-forespørsel fra altinn-auth",
      "--force",
    ]);
    gh([
      "label",
      "create",
      WAITING,
      "-R",
      OWN_REPO,
      "--color",
      "fbca04",
      "--description",
      "Venter på merge/deploy",
      "--force",
    ]);
  }
  registerRequests();
  if (AUTO) {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();
    registerAutoPullRequests(since);
    registerCompletedFeatures(since);
  }
  startReady();
}
