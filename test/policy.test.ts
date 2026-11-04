import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertAllowedHost } from "../src/policy/environments.js";
import { assertAllowedRepository } from "../src/policy/guard.js";
import { Redactor, SECRET_MARKER } from "../src/policy/redact.js";
import { checkRequest, OwnedData, resolveUrl, type Method } from "../src/policy/requests.js";

const base = new URL("https://platform.at22.altinn.cloud");
const check = (method: Method, path: string, owned = new OwnedData(), allowDelete = false) =>
  checkRequest({ method, url: resolveUrl(base, path), baseUrl: base, allowDelete, owned });

describe("verter", () => {
  it("tillater bare https mot Altinns testmiljøer", () => {
    assert.doesNotThrow(() => assertAllowedHost(new URL("https://platform.at22.altinn.cloud/x")));
    assert.doesNotThrow(() => assertAllowedHost(new URL("https://am.ui.tt02.altinn.no/x")));
    for (const url of [
      "https://platform.altinn.no",
      "https://altinn.no",
      "https://example.com",
      "http://platform.at22.altinn.cloud",
    ]) {
      assert.throws(() => assertAllowedHost(new URL(url)), url);
    }
  });

  it("stopper forsøk på å forlate API-ets vert", () => {
    assert.equal(check("GET", "/resourceregistry/api/v1/resource"), undefined);
    // "//evil.com/x" normaliseres til en sti under samme vert
    assert.equal(resolveUrl(base, "//evil.com/x").host, base.host);
  });
});

describe("DELETE", () => {
  it("avvises mot eksisterende data, også forsøk via snoken-* i stien (normalisert URL)", () => {
    assert.equal(check("DELETE", "/resourceregistry/api/v1/resource/snoken-ws-1"), undefined);
    for (const path of [
      "/resourceregistry/api/v1/resource/ttd-viktig",
      "/resourceregistry/api/v1/resource/snoken-x/../ttd-viktig",
      "/resourceregistry/api/v1/resource/snoken-x/%2e%2e/ttd-viktig",
      "/resourceregistry/api/v1/resource/ttd-viktig?x=/snoken-a",
    ]) {
      assert.match(check("DELETE", path) ?? "", /DELETE er kun lov/, path);
    }
  });

  it("er lov mot data opprettet med POST i økten, f.eks. for å teste tilbaketrekking", () => {
    const owned = new OwnedData();
    const conn = "/accessmanagement/api/v1/enduser/connections/accesspackages";
    owned.rememberPost(resolveUrl(base, `${conn}?party=p1&to=t1&package=pk1`));
    owned.rememberCreated(undefined, '{"id":"a1b2c3d4"}', null);
    // Samme fullmakt som ble gitt kan fjernes (rekkefølgen på parameterne spiller ingen rolle)
    assert.equal(check("DELETE", `${conn}?package=pk1&party=p1&to=t1`, owned), undefined);
    assert.equal(check("DELETE", "/x/a1b2c3d4", owned), undefined);
    // Men ikke en annen mottaker, en annen pakke, en bredere DELETE eller en annen sti
    for (const path of [
      `${conn}?party=p1&to=annen&package=pk1`,
      `${conn}?party=p1&to=t1&package=pk2`,
      `${conn}?party=p1`,
      "/x/ttd-viktig",
    ]) {
      assert.match(check("DELETE", path, owned) ?? "", /DELETE er kun lov/, path);
    }
  });

  it("kan slås på med allowDelete", () => {
    assert.equal(check("DELETE", "/x/ttd-viktig", new OwnedData(), true), undefined);
  });
});

describe("PUT/PATCH", () => {
  it("avvises mot data som ikke er opprettet i økten", () => {
    assert.match(check("PUT", "/resourceregistry/api/v1/resource/ttd-eksisterende") ?? "", /bare lov mot testdata/);
  });

  it("tillates mot id fra POST-body, svar eller Location", () => {
    const owned = new OwnedData();
    owned.rememberCreated('{"identifier":"snoken-trim-1"}', "{}", null);
    owned.rememberCreated(undefined, '{"data":{"partyUuid":"a1b2c3d4"}}', null);
    owned.rememberCreated(undefined, "", "/resource/from-location");
    assert.equal(check("PUT", "/resourceregistry/api/v1/resource/snoken-trim-1", owned), undefined);
    assert.equal(check("PATCH", "/x?id=a1b2c3d4", owned), undefined);
    assert.equal(check("PUT", "/resource/from-location", owned), undefined);
    assert.match(check("PUT", "/resourceregistry/api/v1/resource/snoken-trim-1/../ttd-annen", owned) ?? "", /bare lov/);
  });

  it("GET er alltid lov", () => {
    assert.equal(check("GET", "/resourceregistry/api/v1/resource/ttd-eksisterende"), undefined);
  });
});

describe("hemmeligheter", () => {
  it("erstattes med en synlig markør, korte verdier ignoreres", () => {
    const r = new Redactor(["supersecret", "abc", undefined]);
    assert.equal(r.redact("token=supersecret x=abc"), `token=${SECRET_MARKER} x=abc`);
  });
});

describe("repo-lås", () => {
  it("tillater lokal kjøring og godkjente repoer, stopper andre i Actions", () => {
    assert.doesNotThrow(() => assertAllowedRepository({}));
    assert.doesNotThrow(() =>
      assertAllowedRepository({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "Altinn/altinn-auth" }),
    );
    assert.throws(() => assertAllowedRepository({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "noen/annet" }));
  });
});
