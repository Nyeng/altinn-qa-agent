// Henter token for aktiv bruker fra Altinn test token generator: sluttbrukertoken (GetPersonalToken)
// eller virksomhetstoken for tjenesteeier (GetEnterpriseToken).
// Samme parametre som K6 i altinn-platform-validation-tests: scopes + userId + partyuuid (+ pid/partyId
// når de finnes). Brukernavn/passord er felles for alle miljøer: TOKEN_GENERATOR_USERNAME / _PASSWORD.
import { config } from "./config.js";
import { knownUsers, type TestUser } from "./testusers.js";

const GENERATOR_BASE = "https://altinn-testtools-token-generator.azurewebsites.net/api";

const cache = new Map<string, { token: string; expires: number }>();
const knownSecrets = new Set<string>();

export async function getToken(user: TestUser): Promise<string> {
  const hit = cache.get(user.alias);
  if (hit && hit.expires > Date.now()) return hit.token;

  const username = process.env.TOKEN_GENERATOR_USERNAME;
  const password = process.env.TOKEN_GENERATOR_PASSWORD;
  if (!username || !password) throw new Error("TOKEN_GENERATOR_USERNAME/PASSWORD mangler");

  let endpoint: string;
  const params = new URLSearchParams({ env: config.env, ttl: "3600" });
  if (user.enterprise) {
    // Virksomhetstoken for tjenesteeier (som K6: org + orgNo + scopes)
    endpoint = "GetEnterpriseToken";
    params.set("org", user.enterprise.org);
    params.set("orgNo", user.enterprise.orgNo);
    params.set("scopes", user.enterprise.scopes);
  } else {
    endpoint = "GetPersonalToken";
    params.set("scopes", config.testUser.scopes);
    params.set("authLvl", config.testUser.authLvl);
    if (user.pid) params.set("pid", user.pid);
    if (user.userId) params.set("userId", user.userId);
    if (user.partyId) params.set("partyId", user.partyId);
    if (user.partyUuid) params.set("partyuuid", user.partyUuid);
  }

  const res = await fetch(`${GENERATOR_BASE}/${endpoint}?${params}`, {
    headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Token generator svarte ${res.status} for ${user.alias} i ${config.env}`);
  const token = (await res.text()).trim();
  knownSecrets.add(token);
  // Forny i god tid før utløp (ttl 3600 s).
  cache.set(user.alias, { token, expires: Date.now() + 50 * 60_000 });
  return token;
}

// Alle hemmelige verdier som aldri skal tilbake til modellen.
export function secretsToRedact(): string[] {
  const pids = knownUsers().map((u) => u.pid);
  return [...knownSecrets, ...pids, process.env.TOKEN_GENERATOR_PASSWORD, ...config.secrets].filter(
    (v): v is string => Boolean(v && v.length >= 6),
  );
}
