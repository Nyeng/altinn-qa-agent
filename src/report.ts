import type { SessionResult } from "./agent.js";

// Øktrapport i markdown - samme struktur som en manuell SBTM-rapport.
export function renderReport(charter: string, result: SessionResult, meta: { model: string; env: string; started: Date }): string {
  const section = (title: string, lines: string[]) =>
    lines.length ? `## ${title}\n\n${lines.join("\n")}\n` : `## ${title}\n\n_Ingen._\n`;

  const findings = result.findings.map(
    (f, i) =>
      `### ${i + 1}. ${f.title} (${f.severity})\n\n` +
      `**Steg**\n${f.steps.map((s, n) => `${n + 1}. ${s}`).join("\n")}\n\n` +
      `**Forventet:** ${f.expected}\n\n**Faktisk:** ${f.actual}\n\n` +
      `**Bevis**\n\n\`\`\`\n${f.evidence}\n\`\`\`\n`,
  );
  const notes = result.notes.map((n) => `- **${n.kind}:** ${n.text}`);
  const http = result.httpLog.map((h) => `| ${h.method} | \`${h.path}\` | ${h.status} | ${h.ms} | ${h.why} |`);

  return [
    `# Testøkt (${meta.env}) ${meta.started.toISOString().slice(0, 16).replace("T", " ")}`,
    `Modell: \`${meta.model}\` · Verktøykall: ${result.steps} · Stopp: ${result.stopReason} · ` +
      `Tokens inn/ut/cache: ${result.usage.input}/${result.usage.output}/${result.usage.cacheRead}\n`,
    `## Charter\n\n${charter.trim()}\n`,
    `## Oppsummering\n\n${result.summary || "_Ingen oppsummering._"}\n`,
    section(`Funn (${result.findings.length})`, findings),
    section("Notater", notes),
    section("HTTP-logg", http.length ? ["| Metode | Sti | Status | ms | Hvorfor |", "|---|---|---|---|---|", ...http] : []),
  ].join("\n");
}
