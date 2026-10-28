import type { SessionResult } from "./agent.js";
import type { HttpLogEntry } from "./tools/http.js";

// Rapporten er bevisst kort: en punktliste over hva som er verifisert (mot akseptansekriterier der de finnes)
// og eventuelle funn. Reproduksjon (curl + svar) ligger sammenfoldet under hvert funn.
// Forespørsler og svar hentes fra HTTP-loggen (fasit), ikke fra modellens tekst.

const ICON = { bestått: "✅", feilet: "❌", "ikke testet": "⚪" } as const;

export function renderReport(result: SessionResult, meta: { env: string; title?: string }): string {
  const byId = new Map(result.httpLog.map((e) => [e.id, e]));

  const verified = result.checks.length
    ? result.checks.map((c) =>
        c.result === "bestått"
          ? `- ✅ ${c.criterion}`
          : c.result === "feilet"
            ? `- ❌ ${c.criterion} – ${c.actual}`
            : `- ⚪ Ikke testet: ${c.criterion}`,
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

  return [
    `### 🕵️ ${meta.title ?? "Snoken"} · ${meta.env}`,
    "",
    "**Verifisert**",
    ...verified,
    "",
    "**Funn**",
    ...findings,
  ].join("\n");
}

function reproduce(e: HttpLogEntry): string[] {
  const headers = [`Authorization: Bearer ${e.auth}`, ...Object.entries(e.requestHeaders).map(([k, v]) => `${k}: ${v}`)];
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
    ...e.responseExcerpt.slice(0, 800).split("\n").map((l) => `  ${l}`),
    "  ```",
    "",
  ];
}
