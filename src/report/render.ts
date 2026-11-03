import type { AgentResult } from "../agent/loop.js";
import type { HttpLogEntry } from "../agent/session.js";
import type { TestUser } from "../altinn/test-users.js";

// Rapporten er bevisst kort: en punktliste over hva som er verifisert (mot akseptansekriterier der de finnes)
// og eventuelle funn. Reproduksjon (curl + svar) ligger sammenfoldet under hvert funn.
// Forespørsler og svar hentes fra HTTP-loggen (fasit), ikke fra modellens tekst.

const ICON = { bestått: "✅", feilet: "❌", "ikke testet": "⚪" } as const;

/** Statuslinjen i issueteksten: skiller helt testet fra delvis og ikke testet. */
export function runStatus(checks: AgentResult["checks"]): string {
  const untested = checks.filter((c) => c.result === "ikke testet").length;
  if (checks.length === 0 || untested === checks.length) return "⚪ Ikke testet";
  if (untested > 0) return `🟡 Delvis testet (${checks.length - untested} av ${checks.length} krav)`;
  return "✅ Testet";
}

export function renderReport(
  result: AgentResult,
  meta: { env: string; model: string; title?: string; runUrl?: string; testUsers?: TestUser[] },
): string {
  const byId = new Map(result.httpLog.map((e) => [e.id, e]));

  const verified = result.checks.length
    ? result.checks.map((c) =>
        c.result === "bestått"
          ? `- ✅ ${c.criterion}`
          : c.result === "feilet"
            ? `- ❌ ${c.criterion} – ${c.actual}`
            : `- ⚪ Ikke testet: ${c.criterion} – ${c.actual}${c.coverage ? ` Trengs: ${c.coverage}` : ""}`,
      )
    : ["- Ingenting ble verifisert."];

  const findings = result.findings.length
    ? result.findings.map((f) => {
        const calls = f.calls.map((id) => byId.get(id)).filter((e): e is HttpLogEntry => Boolean(e));
        return [
          `- 🐞 **${f.title}** (${f.severity}) – forventet ${f.expected}, faktisk ${f.actual}`,
          "  <details><summary>Reproduser</summary>",
          "",
          ...calls.flatMap((e) => reproduce(e)),
          "  </details>",
        ].join("\n");
      })
    : ["- Ingen"];

  // Fødselsnummer settes inn her, etter kjøringen - modellen ser det aldri. Med pid kan man logge inn med TestID
  // direkte, uten å slå opp brukeren i registeret. Bare syntetiske brukere fra testdatakatalogen.
  const testdata = (meta.testUsers ?? [])
    .filter((u) => u.pid && u.fromCatalog)
    .map((u) => `${u.alias} (${u.category}): pid ${u.pid}${u.userId ? ` · userId ${u.userId}` : ""}`);

  return [
    `### 🕵️ ${meta.title ?? "Son of Vegard"} · ${meta.env}`,
    "",
    ...(testdata.length ? [`**Testdata:** ${testdata.join("; ")}`, ""] : []),
    "**Verifisert**",
    ...verified,
    "",
    "**Funn**",
    ...findings,
    "",
    `<sub>${[
      meta.model,
      `${result.httpLog.length} kall`,
      Number.isNaN(result.costUsd) ? "pris ukjent" : `$${result.costUsd.toFixed(2)}`,
      meta.runUrl && `[logg](${meta.runUrl})`,
    ]
      .filter(Boolean)
      .join(" · ")}</sub>`,
  ].join("\n");
}

function reproduce(e: HttpLogEntry): string[] {
  const headers = [
    `Authorization: Bearer ${e.auth}`,
    ...Object.entries(e.requestHeaders).map(([k, v]) => `${k}: ${v}`),
  ];
  const curl = [
    `curl -i -X ${e.method} '${e.url}'`,
    ...headers.map((h) => `  -H '${h.replaceAll("'", "'\\''")}'`),
    ...(e.requestBody ? [`  --data '${e.requestBody.replaceAll("'", "'\\''")}'`] : []),
  ].join(" \\\n");
  return [
    `  Svar: **${e.status}**${e.contentType ? ` (${e.contentType})` : ""}`,
    "",
    "  ```bash",
    ...curl.split("\n").map((l) => `  ${l}`),
    "  ```",
    "",
    "  ```",
    ...e.responseExcerpt
      .slice(0, 800)
      .split("\n")
      .map((l) => `  ${l}`),
    "  ```",
    "",
  ];
}
