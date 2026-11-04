// Fyller inn ID-ene API-tokens trenger for innloggingsbrukerne i testdata/klientdelegering/<miljø>.csv:
// logger inn hver bruker med TestID (headless), leser userId/partyId fra tokenets claims, partyUuid fra /user/profile
// og aktørens partyId/partyUuid (orgPartyId/orgUuid) fra aktørlista. Skriver bare ID-ene, aldri tokenet. Prod blokkeres.
// Bruker Playwright fra altinn-platform-validation-tests (~/Digdir/Repos/...), siden dette repoet ikke har det.
//
//   node scripts/hent-klient-ider.mjs [miljø ...]   (standard: at22 at23 tt02)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire(
  `${process.env.HOME}/Digdir/Repos/altinn-platform-validation-tests/playwright/package.json`,
);
const { chromium } = require("playwright");

const envs = process.argv.slice(2).length ? process.argv.slice(2) : ["at22", "at23", "tt02"];
const host = (env) => (env === "tt02" ? "https://am.ui.tt02.altinn.no" : `https://am.ui.${env}.altinn.cloud`);
const isProd = (h) => (/(^|\.)altinn\.no$/.test(h) && !/tt02/.test(h)) || /^(www\.|login\.)?idporten\.no$/.test(h);

// Komma inne i "sitert verdi" deler ikke feltet (beskrivelsene har komma).
const split = (line) =>
  line
    .match(/("([^"]|"")*"|[^,]*)(,|$)/g)
    .slice(0, -1)
    .map((f) => f.replace(/,$/, ""));
const unquote = (f) => (f.startsWith('"') ? f.slice(1, -1).replaceAll('""', '"') : f);
const quote = (v) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

const browser = await chromium.launch();
for (const env of envs) {
  const path = `testdata/klientdelegering/${env}.csv`;
  const [header, ...lines] = readFileSync(path, "utf8").trim().split("\n");
  const cols = split(header);
  const rows = lines.map((l) => Object.fromEntries(split(l).map((f, i) => [cols[i], unquote(f)])));

  for (const r of rows) {
    const ctx = await browser.newContext();
    let prodHit;
    await ctx.route("**/*", (route) => {
      const h = new URL(route.request().url()).hostname;
      if (isProd(h)) {
        prodHit = h;
        return route.abort();
      }
      return route.continue();
    });
    const page = await ctx.newPage();
    try {
      await page.goto(`${host(env)}/accessmanagement/ui/`);
      const testId = page.getByRole("link", { name: /TestID/i }).first();
      await testId.waitFor({ timeout: 45_000 });
      await testId.click();
      await page.locator('input[name="pid"]').fill(r.pid);
      await page.locator("#submit").click();
      await page.waitForURL((u) => u.hostname.startsWith("am.ui."), { timeout: 60_000 });
      if (prodHit) throw new Error(`prod-vert ${prodHit}`);
      const token = (await ctx.cookies()).find((c) => c.name === "AltinnStudioRuntime")?.value;
      const claims = token ? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) : {};
      const api = `${host(env)}/accessmanagement/api/v1/user`;
      const profile = await (await page.request.get(`${api}/profile`)).json();
      const actors = await (await page.request.get(`${api}/actorlist/old`)).json();
      const flat = (list) => list.flatMap((a) => [a, ...flat(a.subunits ?? [])]);
      const actor = flat(actors).find((a) => a.organizationNumber === r.orgNo);
      if (!actor) throw new Error(`aktør ${r.orgNo} ikke i aktørlista (${actors.length} aktører)`);
      Object.assign(r, {
        userId: String(claims["urn:altinn:userid"] ?? ""),
        partyId: String(claims["urn:altinn:partyid"] ?? ""),
        partyUuid: profile?.party?.partyUuid ?? "",
        orgPartyId: String(actor.partyId),
        orgUuid: actor.partyUuid,
      });
      console.log(`${env} ${r.profile}: userId ${r.userId}, partyId ${r.partyId}, aktør ${r.orgPartyId}`);
    } catch (e) {
      console.log(`${env} ${r.profile}: FEIL ${String(e.message ?? e).split("\n")[0]} - beholder gamle ID-er`);
    }
    await ctx.close();
  }
  writeFileSync(
    path,
    [cols.join(","), ...rows.map((r) => cols.map((c) => quote(r[c] ?? "")).join(","))].join("\n") + "\n",
  );
}
await browser.close();
