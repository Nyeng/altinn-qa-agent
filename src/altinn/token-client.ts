// Henter tokens fra Altinn test token generator - samme verktøy og parametre som altinn-platform-validation-tests:
//   sluttbruker:   GetPersonalToken   (scopes + userId + partyuuid, og pid/partyId når de finnes)
//   tjenesteeier:  GetEnterpriseToken (org + orgNo + scopes)
// Brukernavn/passord er felles for alle miljøer. Tokens caches per bruker og registreres som hemmeligheter.
import type { Redactor } from "../policy/redact.js";
import type { TestUser } from "./test-users.js";

const GENERATOR_BASE = "https://altinn-testtools-token-generator.azurewebsites.net/api";
const TTL_SECONDS = 3600;
const RENEW_AFTER_MS = 50 * 60_000; // forny i god tid før utløp

export type TokenClientOptions = {
  env: string;
  username?: string;
  password?: string;
  personalScopes: string;
  authLvl: string;
  redactor: Redactor;
  fetch?: typeof fetch;
};

export class TokenClient {
  private readonly cache = new Map<string, { token: string; expires: number }>();

  constructor(private readonly opts: TokenClientOptions) {}

  async tokenFor(user: TestUser): Promise<string> {
    const hit = this.cache.get(user.alias);
    if (hit && hit.expires > Date.now()) return hit.token;

    const { username, password, env } = this.opts;
    if (!username || !password) throw new Error("TOKEN_GENERATOR_USERNAME/PASSWORD mangler");

    const params = new URLSearchParams({ env, ttl: String(TTL_SECONDS) });
    let endpoint: string;
    if (user.enterprise) {
      endpoint = "GetEnterpriseToken";
      params.set("org", user.enterprise.org);
      params.set("orgNo", user.enterprise.orgNo);
      params.set("scopes", user.enterprise.scopes);
    } else {
      endpoint = "GetPersonalToken";
      params.set("scopes", this.opts.personalScopes);
      params.set("authLvl", this.opts.authLvl);
      if (user.pid) params.set("pid", user.pid);
      if (user.userId) params.set("userId", user.userId);
      if (user.partyId) params.set("partyId", user.partyId);
      if (user.partyUuid) params.set("partyuuid", user.partyUuid);
    }

    const doFetch = this.opts.fetch ?? fetch;
    const res = await doFetch(`${GENERATOR_BASE}/${endpoint}?${params}`, {
      headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Token generator svarte ${res.status} for ${user.alias} i ${env}`);

    const token = (await res.text()).trim();
    this.opts.redactor.add(token);
    this.cache.set(user.alias, { token, expires: Date.now() + RENEW_AFTER_MS });
    return token;
  }

  /** Beskrivelse av tokenet til curl-kommandoer i rapporten - aldri selve tokenet. */
  describe(user: TestUser): string {
    if (user.enterprise) {
      const e = user.enterprise;
      return `<virksomhetstoken: GetEnterpriseToken org=${e.org} orgNo=${e.orgNo} scopes="${e.scopes}" env=${this.opts.env}>`;
    }
    const ids = [user.userId && `userId=${user.userId}`, user.partyUuid && `partyuuid=${user.partyUuid}`].filter(
      Boolean,
    );
    return `<sluttbrukertoken: GetPersonalToken env=${this.opts.env} for testbruker ${user.alias} (${ids.join(" ") || user.category})>`;
  }
}
