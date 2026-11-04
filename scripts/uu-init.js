// UU-sjekk i GUI-testingen. Lastes av Playwright MCP etter axe-core (se .mcp.json), i alle sider.
// I browser_evaluate: `() => window.snokenUu("main")` gir WCAG 2.1 A/AA-brudd i den delen av siden, kompakt.
window.snokenUu = async (selector = "body") => {
  const result = await window.axe.run(selector, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  });
  return result.violations.map((v) => ({
    regel: v.id,
    alvor: v.impact,
    // "wcag1410" → "1.4.10"
    wcag: v.tags.filter((t) => /^wcag\d{3,}$/.test(t)).map((t) => t.replace(/^wcag(\d)(\d)(\d+)$/, "$1.$2.$3")),
    hjelp: v.help,
    antall: v.nodes.length,
    eksempler: v.nodes.slice(0, 2).map((n) => ({ mål: n.target.join(" "), html: n.html.slice(0, 160) })),
  }));
};
