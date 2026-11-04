// Fyller inn ID-ene API-tokens trenger for innloggingsbrukerne i testdata/klientdelegering/<miljø>.csv:
// logger inn hver bruker med TestID (headless), leser userId/partyId fra tokenets claims, partyUuid fra /user/profile
// og aktørens partyId/partyUuid (orgPartyId/orgUuid) fra aktørlista. Skriver bare ID-ene, aldri tokenet.
// Bare testmiljøene: andre miljønavn avvises, og havner innloggingen på en annen vert enn testmiljøets, stopper den.
// Bruker Playwright fra altinn-platform-validation-tests (~/Digdir/Repos/...), siden dette repoet ikke har det.
//
//   node scripts/hent-klient-ider.mjs [miljø ...]   (standard: at22 at23 tt02)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire(
  `${process.env.HOME}/Digdir/Repos/altinn-platform-validation-tests/playwright/package.json`,
);
const { chromium } = require("playwright");

const HOSTS = {
  at22: "am.ui.at22.altinn.cloud",
  at23: "am.ui.at23.altinn.cloud",
  tt02: "am.ui.tt02.altinn.no",
};
const envs = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(HOSTS);
const unknown = envs.filter((env) => !HOSTS[env]);
if (unknown.length) throw new Error(`Ukjent miljø: ${unknown.join(", ")}. Bare ${Object.keys(HOSTS).join(", ")}.`);

const browser = await chromium.launch();
for (const env of envs) {
  const host = HOSTS[env];
  const path = `testdata/klientdelegering/${env}.csv`;
  const [header, ...lines] = readFileSync(path, "utf8").trim().split("\n");
  const cols = header.split(",");
  const rows = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));

  for (const r of rows) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(`https://${host}/accessmanagement/ui/`);
      const testId = page.getByRole("link", { name: /TestID/i }).first();
      await testId.waitFor({ timeout: 45_000 });
      await testId.click();
      await page.locator('input[name="pid"]').fill(r.pid);
      await page.locator("#submit").click();
      await page.waitForURL((u) => u.hostname === host, { timeout: 60_000 });
      const token = (await ctx.cookies()).find((c) => c.name === "AltinnStudioRuntime")?.value;
      const claims = token ? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) : {};
      const api = `https://${host}/accessmanagement/api/v1/user`;
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
  writeFileSync(path, [cols.join(","), ...rows.map((r) => cols.map((c) => r[c]).join(","))].join("\n") + "\n");
}
await browser.close();
