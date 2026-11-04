// Henter ID-ene API-tokens trenger for innloggingsbrukerne i testdata/klientdelegering/klientvirksomheter-alle.csv:
// logger inn hver bruker med TestID (headless), leser userId/partyId fra tokenets claims, partyUuid fra /user/profile
// og aktørens partyId/partyUuid fra aktørlista. Skriver bare ID-ene, aldri tokenet. Prod blokkeres.
// Bruker Playwright fra altinn-platform-validation-tests (~/Digdir/Repos/...), siden dette repoet ikke har det.
//
//   node scripts/hent-klient-ider.mjs [miljø | pid | miljø:pid]   → reports/klient-ider.json
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire(
  `${process.env.HOME}/Digdir/Repos/altinn-platform-validation-tests/playwright/package.json`,
);
const { chromium } = require("playwright");

const csvPath = "testdata/klientdelegering/klientvirksomheter-alle.csv";
const [header, ...lines] = readFileSync(csvPath, "utf8").trim().split("\n");
const cols = header.split(",");
const rows = lines.map((l) => {
  const v = l.split(",");
  return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
});
const only = process.argv[2]; // valgfritt: miljø eller pid
const host = (env) => (env === "tt02" ? "https://am.ui.tt02.altinn.no" : `https://am.ui.${env}.altinn.cloud`);

const isProd = (h) => (/(^|\.)altinn\.no$/.test(h) && !/tt02/.test(h)) || /^(www\.|login\.)?idporten\.no$/.test(h);

const out = [];
const browser = await chromium.launch();
for (const r of rows.filter(
  (r) => !only || r.miljo === only || r.innloggingPid === only || `${r.miljo}:${r.innloggingPid}` === only,
)) {
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
  const res = { miljo: r.miljo, profil: r.profil, pid: r.innloggingPid };
  try {
    await page.goto(`${host(r.miljo)}/accessmanagement/ui/`);
    const testId = page.getByRole("link", { name: /TestID/i }).first();
    await testId.waitFor({ timeout: 45_000 });
    await testId.click();
    await page.locator('input[name="pid"]').fill(r.innloggingPid);
    await page.locator("#submit").click();
    await page.waitForURL((u) => u.hostname.startsWith("am.ui."), { timeout: 60_000 });
    if (prodHit) throw new Error(`prod-vert ${prodHit}`);
    const token = (await ctx.cookies()).find((c) => c.name === "AltinnStudioRuntime")?.value;
    const claims = token ? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) : {};
    res.userId = claims["urn:altinn:userid"];
    res.partyId = claims["urn:altinn:partyid"];
    const api = `${host(r.miljo)}/accessmanagement/api/v1/user`;
    const profile = await (await page.request.get(`${api}/profile`)).json();
    res.partyUuid = profile?.party?.partyUuid ?? profile?.party?.uuid ?? claims["urn:altinn:party:uuid"];
    if (!res.partyUuid)
      res.keys = {
        party: Object.keys(profile?.party ?? {}),
        claims: Object.keys(claims).filter((k) => k.startsWith("urn")),
      };
    res.profilePartyId = profile?.party?.partyId;
    const actors = await (await page.request.get(`${api}/actorlist/old`)).json();
    const flat = (list) => list.flatMap((a) => [a, ...flat(a.subunits ?? [])]);
    const actor = flat(actors).find((a) => a.organizationNumber === r.aktorOrgnr);
    res.aktorPartyUuid = actor?.partyUuid;
    res.aktorPartyId = actor?.partyId;
    if (!actor) res.note = `aktør ${r.aktorOrgnr} ikke i aktørlista (${actors.length} aktører)`;
  } catch (e) {
    res.error = String(e.message ?? e).split("\n")[0];
  }
  console.log(JSON.stringify(res));
  out.push(res);
  await ctx.close();
}
await browser.close();
writeFileSync("reports/klient-ider.json", JSON.stringify(out, null, 2));
