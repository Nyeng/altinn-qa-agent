// Publiserer Son of Vegards resultat i en issue uten støy:
//   - rapporten er ÉN kommentar som oppdateres ved hver kjøring (aldri flere rapporter)
//   - status står i en linje i issueteksten, ikke som egne kommentarer
//
// Bruk: node scripts/publish.mjs report <issue> <fil>    (oppdaterer/oppretter rapportkommentaren)
//       node scripts/publish.mjs status <issue> <tekst>  (oppdaterer statuslinjen i issueteksten)
//       node scripts/publish.mjs triage <issue> <antall funn>  (åpen med «mulig-bug», ellers lukket)
// Leser GH_TOKEN og GITHUB_REPOSITORY fra miljøet.
import { readFileSync } from "node:fs";
import { gh } from "./altinn.mjs";
import { noBacklink } from "./issue-text.mjs";

const REPO = process.env.GITHUB_REPOSITORY ?? "Nyeng/altinn-qa-agent";
const REPORT_MARKER = "<!-- snoken-rapport -->";
const STATUS_RE = /^\*\*Status:\*\*.*$/m;

export function upsertReport(issue, body) {
  const text = `${REPORT_MARKER}\n${noBacklink(body)}`;
  const comments = JSON.parse(
    gh(["api", `repos/${REPO}/issues/${issue}/comments?per_page=100`, "--paginate", "--slurp"]),
  ).flat();
  const existing = comments.find((c) => c.body?.startsWith(REPORT_MARKER));
  if (existing) {
    gh(
      ["api", "-X", "PATCH", `repos/${REPO}/issues/comments/${existing.id}`, "--input", "-"],
      JSON.stringify({ body: text }),
    );
  } else {
    gh(["api", "-X", "POST", `repos/${REPO}/issues/${issue}/comments`, "--input", "-"], JSON.stringify({ body: text }));
  }
}

export function setStatus(issue, status) {
  const body = JSON.parse(gh(["issue", "view", String(issue), "-R", REPO, "--json", "body"])).body ?? "";
  const line = `**Status:** ${status}`;
  const next = STATUS_RE.test(body) ? body.replace(STATUS_RE, line) : `${line}\n\n${body}`;
  if (next !== body) gh(["issue", "edit", String(issue), "-R", REPO, "--body-file", "-"], next);
}

/** Funn → åpen med label «mulig-bug» (til vurdering). Ingen funn → lukket uten label. */
export function triage(issue, findings) {
  const n = String(issue);
  gh([
    "label",
    "create",
    "mulig-bug",
    "-R",
    REPO,
    "--color",
    "d93f0b",
    "--description",
    "Nye funn som ikke er meldt i altinn-auth - må ses på manuelt",
    "--force",
  ]);
  if (Number(findings) > 0) {
    gh(["issue", "edit", n, "-R", REPO, "--add-label", "mulig-bug"]);
    gh(["issue", "reopen", n, "-R", REPO]);
  } else {
    gh(["issue", "edit", n, "-R", REPO, "--remove-label", "mulig-bug"]);
    gh(["issue", "close", n, "-R", REPO]);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, issue, arg] = process.argv.slice(2);
  if (!issue) process.exit(0); // ingen issue (f.eks. Run workflow uten issue) - bare job summary
  if (cmd === "report") upsertReport(issue, readFileSync(arg, "utf8"));
  else if (cmd === "status") setStatus(issue, arg);
  else if (cmd === "triage") triage(issue, arg);
  else throw new Error(`Ukjent kommando: ${cmd}`);
}
