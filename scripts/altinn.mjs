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

// Features oppdatert siden `since` der alle (ikke-forkastede) sub-issues er lukket.
export function completedFeaturesSince(since) {
  const res = graphql(
    "query($q:String!){search(query:$q,type:ISSUE,first:50){nodes{... on Issue{number title url state " +
      "subIssuesSummary{total completed}}}}}",
    { q: `repo:${SOURCE_REPO} is:issue type:Feature updated:>=${since.slice(0, 10)}` },
  );
  return res.search.nodes.filter(
    (f) => f.subIssuesSummary?.total > 0 && f.subIssuesSummary.completed === f.subIssuesSummary.total,
  );
}
