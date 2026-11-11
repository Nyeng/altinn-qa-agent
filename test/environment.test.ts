import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Session } from "../src/agent/session.js";
import { loadConfig } from "../src/config.js";
import { loadEnvironment } from "../src/environment-file.js";
import { ENVIRONMENTS, type EnvName } from "../src/policy/environments.js";
import { runTool } from "../src/tools/define.js";
import { createTools } from "../src/tools/index.js";
import { fakeFetch, json } from "./helpers.js";

const PID = "28858397334";

function envDir(file: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "snoken-env-"));
  writeFileSync(path.join(dir, "at22.json"), JSON.stringify({ env: "at22", ...file }));
  return dir;
}

const fixture = {
  secrets: { REGISTER_SUBSCRIPTION_KEY: "$env:REG_AT22" },
  testUsers: {
    A: {
      description: "Ber om tilgang",
      pid: PID,
      userId: "20990712",
      partyUuid: "ced9acb3-c41c-41fd-a718-31c5694b4117",
      org: { orgNo: "214276372", name: "MINKENDE SORGLØS TIGER AS", role: "daglig leder" },
    },
  },
  resources: { "ttd-dialogporten-dummy": { rightKeys: { read: `01${"a".repeat(64)}` } } },
  flags: { "AccessManagement.Enduser.RequestV2Api": { on: true, checked: "2026-11-09", how: "v2 svarte ikke 404" } },
  limits: { maxSteps: 12 },
};

describe("miljøfilene i repoet", () => {
  for (const env of Object.keys(ENVIRONMENTS) as EnvName[]) {
    it(`${env}.json er gyldig og har bare $env-referanser som hemmeligheter`, () => {
      const loaded = loadEnvironment(env, {});
      assert.equal(loaded.file.env, env);
      assert.deepEqual(loaded.secrets, {});
      assert.ok(Object.keys(loaded.file.secrets).length > 0);
    });
  }
});

describe("miljøfil", () => {
  it("slår opp hemmeligheter i miljøet, og K6-konfigen vinner", () => {
    const dir = envDir(fixture);
    const fromEnv = loadConfig(["--env=at22"], { QA_ENVIRONMENTS_DIR: dir, REG_AT22: "reg-fra-env" });
    assert.equal(fromEnv.apis.platform.headerRules[0].headers["Ocp-Apim-Subscription-Key"], "reg-fra-env");
    assert.ok(fromEnv.secrets.includes("reg-fra-env"));
    assert.equal(fromEnv.maxSteps, 12);

    const k6 = loadConfig(["--env=at22"], {
      QA_ENVIRONMENTS_DIR: dir,
      REG_AT22: "reg-fra-env",
      QA_CONFIG_AT22: JSON.stringify({ REGISTER_SUBSCRIPTION_KEY: "reg-fra-k6" }),
    });
    assert.equal(k6.apis.platform.headerRules[0].headers["Ocp-Apim-Subscription-Key"], "reg-fra-k6");
  });

  it("avviser hemmeligheter skrevet rett i fila, og fil for feil miljø", () => {
    assert.throws(
      () => loadEnvironment("at22", { QA_ENVIRONMENTS_DIR: envDir({ secrets: { KEY: "hemmelig-verdi" } }) }),
      /\$env:NAVN/,
    );
    const dir = mkdtempSync(path.join(tmpdir(), "snoken-env-"));
    writeFileSync(path.join(dir, "at22.json"), JSON.stringify({ env: "at23" }));
    assert.throws(() => loadEnvironment("at22", { QA_ENVIRONMENTS_DIR: dir }), /er for at23/);
  });
});

describe("use_test_user og env_info", () => {
  function session() {
    const { fetch } = fakeFetch(() => json({}));
    const config = loadConfig(["--env=at22"], {
      QA_ENVIRONMENTS_DIR: envDir(fixture),
      TOKEN_GENERATOR_USERNAME: "u",
      TOKEN_GENERATOR_PASSWORD: "generator-password",
    });
    const s = new Session(config, { fetch, random: () => 0 });
    return { s, tools: createTools(s) };
  }

  it("aktiverer den faste brukeren med navnet fra fila, og viser aldri fødselsnummeret", async () => {
    const { s, tools } = session();
    const out = await runTool(tools, "use_test_user", { name: "A" }, s);
    assert.match(out.content, /Aktiv bruker er nå A .*MINKENDE SORGLØS TIGER AS.*daglig leder/);
    assert.ok(!out.content.includes(PID));
    assert.equal(s.users.active?.alias, "A");

    // Samme bruker to ganger gir ikke to brukere, og poolbrukere nummereres som før
    await runTool(tools, "use_test_user", { name: "A" }, s);
    await runTool(tools, "use_service_owner", { owner: "ttd", scopes: ["altinn:resourceregistry/resource.read"] }, s);
    assert.deepEqual(
      s.users.all().map((u) => u.alias),
      ["A", "bruker-A"],
    );
    assert.equal((await runTool(tools, "use_test_user", { name: "Z" }, s)).isError, true);
  });

  it("env_info viser faste brukere, RightKeys og flagg med dato", async () => {
    const { s, tools } = session();
    const out = (await runTool(tools, "env_info", {}, s)).content;
    assert.match(out, /- A: Ber om tilgang · partyUuid ced9acb3/);
    assert.match(out, /ttd-dialogporten-dummy\n {4}read: 01a{64}/);
    assert.match(out, /AccessManagement\.Enduser\.RequestV2Api: på \(bekreftet 2026-11-09, v2 svarte ikke 404\)/);
    assert.ok(!out.includes(PID));
  });

  it("uten faste brukere finnes ikke use_test_user, men env_info gjør", () => {
    const config = loadConfig(["--env=at22"], { QA_ENVIRONMENTS_DIR: envDir({}) });
    const names = createTools(new Session(config)).map((t) => t.name);
    assert.ok(!names.includes("use_test_user"));
    assert.ok(names.includes("env_info"));
  });
});
