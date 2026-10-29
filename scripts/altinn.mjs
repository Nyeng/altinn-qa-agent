// Felles hjelpere for skriptene: gh-CLI-kall og oppslag mot Altinn/altinn-auth (kun lesing, offentlig repo).
// Skriptene kjøres med ren node i GitHub Actions (uten npm install), derfor JavaScript uten avhengigheter.
// Hierarkiet følger ADR-0004: Epic → Feature (historie + akseptansekriterier) → sub-issues → PR-er som lukker dem.
import { execFileSync } from "node:child_process";

export const SOURCE_REPO = "Altinn/altinn-auth";
const [OWNER, NAME] = SOURCE_REPO.split("/");

export function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, maxBuffer: 20e6 }).trim();
}
export const ghJson = (args) => JSON.parse(gh(args) || "null");

export function graphql(query, vars = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`, "-F", `o=${OWNER}`, "-F", `n=${NAME}`];
  for (const [k, v] of Object.entries(vars)) args.push("-F", `${k}=${v}`);
  return JSON.parse(gh(args)).data;
}

// Issuene en PR lukker (Resolves/Fixes #N).
export function closingIssues(pr) {
  return (
    graphql(
      "query($o:String!,$n:String!,$pr:Int!){repository(owner:$o,name:$n){pullRequest(number:$pr){" +
        "closingIssuesReferences(first:5){nodes{number title body url issueType{name}}}}}}",
      { pr },
    ).repository.pullRequest?.closingIssuesReferences?.nodes ?? []
  );
}

// Nærmeste Feature over et issue (issuet selv, forelder eller besteforelder). Stopper ved Epic.
export function featureOf(issue) {
  const node = graphql(
    "query($o:String!,$n:String!,$i:Int!){repository(owner:$o,name:$n){issue(number:$i){" +
      "number title body url issueType{name} parent{number title body url issueType{name} " +
      "parent{number title body url issueType{name}}}}}}",
    { i: issue },
  ).repository.issue;
  for (let n = node; n; n = n.parent) {
    const type = n.issueType?.name;
    if (type === "Feature") return n;
    if (type === "Epic") return undefined;
  }
  return undefined;
}

// En Feature med sub-issues og PR-ene som lukket dem.
export function featureDetails(feature) {
  const issue = graphql(
    "query($o:String!,$n:String!,$i:Int!){repository(owner:$o,name:$n){issue(number:$i){" +
      "number title body url state subIssuesSummary{total completed} " +
      "subIssues(first:50){nodes{number title state stateReason " +
      "timelineItems(itemTypes:[CLOSED_EVENT],last:1){nodes{... on ClosedEvent{closer{... on PullRequest{number merged repository{nameWithOwner}}}}}}}}}}}",
    { i: feature },
  ).repository.issue;
  const subIssues = issue.subIssues.nodes.map((s) => {
    const closer = s.timelineItems.nodes[0]?.closer;
    return {
      number: s.number,
      title: s.title,
      state: s.state,
      stateReason: s.stateReason,
      // Bare PR-er i altinn-auth kan deploy-sjekkes herfra (frontend m.fl. ligger i andre repoer).
      pr: closer?.repository?.nameWithOwner === SOURCE_REPO ? closer.number : undefined,
      externalPr:
        closer && closer.repository?.nameWithOwner !== SOURCE_REPO
          ? `${closer.repository?.nameWithOwner}#${closer.number}`
          : undefined,
    };
  });
  return { ...issue, subIssues };
}

// NB: Søke-API-et (gh pr list --search, GraphQL search) kan ikke brukes her: GITHUB_TOKEN i Actions kan bare
// søke i sitt eget repo. Derfor vanlige REST-lister, som virker mot det offentlige altinn-auth-repoet.

// PR-er merget etter `since`, med filer (sti og antall endrede linjer).
export function mergedPullRequestsSince(since) {
  const pulls =
    ghJson(["api", `repos/${SOURCE_REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100`]) ?? [];
  return pulls
    .filter((p) => p.merged_at && p.merged_at >= since)
    .map((p) => ({
      number: p.number,
      title: p.title,
      url: p.html_url,
      body: p.body ?? "",
      mergedAt: p.merged_at,
      files: ghJson(["api", `repos/${SOURCE_REPO}/pulls/${p.number}/files?per_page=100`, "--paginate", "--slurp"])
        .flat()
        .map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions })),
    }));
}

// Features oppdatert etter `since` der alle sub-issues er lukket.
export function completedFeaturesSince(since) {
  const issues = ghJson([
    "api",
    `repos/${SOURCE_REPO}/issues?state=all&since=${since}&per_page=100`,
    "--paginate",
    "--slurp",
  ]).flat();
  return issues
    .filter((i) => !i.pull_request && i.type?.name === "Feature")
    .filter((i) => i.sub_issues_summary?.total > 0 && i.sub_issues_summary.completed === i.sub_issues_summary.total)
    .map((i) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      state: i.state.toUpperCase(),
      body: i.body ?? "",
      subIssuesSummary: { total: i.sub_issues_summary.total, completed: i.sub_issues_summary.completed },
    }));
}
