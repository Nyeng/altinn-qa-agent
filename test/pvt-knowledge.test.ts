import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PvtKnowledge, summarizeClient } from "../src/altinn/pvt-knowledge.js";
import { checkRequest, OwnedData, resolveUrl } from "../src/policy/requests.js";
import { runTool } from "../src/tools/define.js";
import { createTools } from "../src/tools/index.js";
import { testSession } from "./helpers.js";

// Kort utdrag i samme stil som K6-klientene i altinn-platform-validation-tests.
const CLIENT = `
class RequestClient {
    /**
     * @param {string} baseUrl Base URL
     */
    constructor(baseUrl, tokenGenerator) {
        this.BASE_PATH = "/accessmanagement/api/v1/enduser/request";
        this.FULL_PATH = \`\${baseUrl}\${this.BASE_PATH}\`;
    }

    /**
     * Creates a package request. Needs an end user token from ID-porten.
     * @param {string} party Party UUID.
     */
    CreatePackageRequest(party, to, packageId, labels = null) {
        return http.post(
            buildUrl(\`\${this.FULL_PATH}/package\`, { party, to, package: packageId }),
            jsonBody({}),
        );
    }

    /**
     * Gets a dialog.
     */
    GetDialog(dialogId, labels = null) {
        return http.get(this.FULL_PATH + "/dialogs" + \`/\${dialogId}\`);
    }
}
`;

const SCOPES = `export const AltinnScopes = {
  A: "altinn:resourceregistry/resource.write",
  B: "altinn:authorization/authorize.admin",
  C: "altinn:serviceowner/notifications.create",
  D: "altinn:consentrequests.read altinn:consentrequests.write",
};`;

function pvtFetch() {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("git/trees")) {
      return new Response(
        JSON.stringify({
          tree: [
            { path: "K6/clients/access-management/enduser/request/request.js", type: "blob" },
            { path: "K6/clients/access-management/enduser/request/request.types.js", type: "blob" },
            { path: "K6/clients/common/request.js", type: "blob" },
          ],
        }),
      );
    }
    if (url.endsWith("K6/scopes.js")) return new Response(SCOPES);
    if (url.endsWith("request/request.js")) return new Response(CLIENT);
    return new Response("{}");
  }) as typeof fetch;
}

describe("kunnskap fra platform-validation-tests", () => {
  it("oppsummerer en K6-klient: metode, sti, query-nøkler, beskrivelse og token", () => {
    const out = summarizeClient("access-management/enduser/request/request", CLIENT);
    assert.match(out, /Token: end user token from ID-porten/);
    assert.match(
      out,
      /- CreatePackageRequest\(party, to, packageId\) → POST \/accessmanagement\/api\/v1\/enduser\/request\/package\?party&to&package — Creates a package request\./,
    );
    assert.match(
      out,
      /- GetDialog\(dialogId\) → GET \/accessmanagement\/api\/v1\/enduser\/request\/dialogs\/\{dialogId\}/,
    );
    assert.doesNotMatch(out, /constructor/);
  });

  it("finner klienter på stikkord og hopper over types/common", async () => {
    const k = new PvtKnowledge({ fetch: pvtFetch() });
    assert.deepEqual(await k.areas(), ["access-management/enduser/request/request"]);
    assert.match(await k.reference("access-management request"), /CreatePackageRequest/);
    assert.match(await k.reference("finnes ikke"), /Ingen PVT-klient matcher/);
  });

  it("scopes: deler opp lister og fjerner admin og varselutsending", async () => {
    const k = new PvtKnowledge({ fetch: pvtFetch() });
    assert.deepEqual(await k.allowedScopes(), [
      "altinn:consentrequests.read",
      "altinn:consentrequests.write",
      "altinn:resourceregistry/resource.write",
    ]);
  });

  it("api_reference er et verktøy agenten kan bruke", async () => {
    const { session } = testSession();
    (session as unknown as { knowledge: PvtKnowledge }).knowledge = new PvtKnowledge({ fetch: pvtFetch() });
    const out = await runTool(createTools(session), "api_reference", { query: "request" }, session);
    assert.match(out.content, /POST \/accessmanagement\/api\/v1\/enduser\/request\/package/);
  });

  it("tjenesteeier kan bare få scopes fra lista", async () => {
    const { session } = testSession();
    const tools = createTools(session);
    const bad = await runTool(
      tools,
      "use_service_owner",
      { owner: "ttd", scopes: ["altinn:authorize.admin"] },
      session,
    );
    assert.equal(bad.isError, true);
  });
});

describe("sperre for utsending til ekte mottakere", () => {
  const base = new URL("https://platform.at22.altinn.cloud");
  const check = (method: "GET" | "POST", path: string) =>
    checkRequest({ method, url: resolveUrl(base, path), baseUrl: base, allowDelete: false, owned: new OwnedData() });

  it("stopper varselbestillinger og videresending på e-post, men tillater lesing", () => {
    assert.match(check("POST", "/notifications/api/v1/future/orders") ?? "", /sperret/);
    assert.match(check("POST", "/notifications/api/v1/future/orders/instant") ?? "", /sperret/);
    assert.match(check("POST", "/correspondence/api/v1/correspondence/abc-123/forward") ?? "", /sperret/);
    assert.equal(check("GET", "/notifications/api/v1/future/orders/abc"), undefined);
    assert.equal(check("POST", "/correspondence/api/v1/correspondence"), undefined);
  });
});
