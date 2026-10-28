// Publiserer Snokens resultat i en issue uten støy:
//   - rapporten er ÉN kommentar som oppdateres ved hver kjøring (aldri flere rapporter)
//   - status står i en linje i issueteksten, ikke som egne kommentarer
//
// Bruk: node scripts/publish.mjs report <issue> <fil>    (oppdaterer/oppretter rapportkommentaren)
//       node scripts/publish.mjs status <issue> <tekst>  (oppdaterer statuslinjen i issueteksten)
// Leser GH_TOKEN og GITHUB_REPOSITORY fra miljøet.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO = process.env.GITHUB_REPOSITORY ?? "Nyeng/altinn-qa-agent";
const REPORT_MARKER = "<!-- snoken-rapport -->";
const STATUS_RE = /^\*\*Status:\*\*.*$/m;

const gh = (args, input) => execFileSync("gh", args, { encoding: "utf8", input, maxBuffer: 20e6 }).trim();

export function upsertReport(issue, body) {
  const text = `${REPORT_MARKER}\n${body}`;
  const comments = JSON.parse(gh(["api", `repos/${REPO}/issues/${issue}/comments?per_page=100`, "--paginate", "--slurp"])).flat();
  const existing = comments.find((c) => c.body?.startsWith(REPORT_MARKER));
  if (existing) {
    gh(["api", "-X", "PATCH", `repos/${REPO}/issues/comments/${existing.id}`, "--input", "-"], JSON.stringify({ body: text }));
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, issue, arg] = process.argv.slice(2);
  if (!issue) process.exit(0); // ingen issue (f.eks. Run workflow uten issue) - bare job summary
  if (cmd === "report") upsertReport(issue, readFileSync(arg, "utf8"));
  else if (cmd === "status") setStatus(issue, arg);
  else throw new Error(`Ukjent kommando: ${cmd}`);
}
