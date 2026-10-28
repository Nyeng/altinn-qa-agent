// Henter sluttbrukertoken for testbrukeren i valgt miljø fra Altinn test token generator
// (GetPersonalToken) - samme verktøy og parametre som altinn-platform-validation-tests og
// altinn-access-management-frontend. Brukernavn/passord er felles for alle miljøer:
// TOKEN_GENERATOR_USERNAME / TOKEN_GENERATOR_PASSWORD.
import { config } from "./config.js";

const GENERATOR_URL = "https://altinn-testtools-token-generator.azurewebsites.net/api/GetPersonalToken";

let cached: { token: string; expires: number } | undefined;

export async function getToken(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.token;

  const username = process.env.TOKEN_GENERATOR_USERNAME;
  const password = process.env.TOKEN_GENERATOR_PASSWORD;
  if (!username || !password) throw new Error("TOKEN_GENERATOR_USERNAME/PASSWORD mangler");

  const user = config.testUser;
  const params = new URLSearchParams({
    env: config.env,
    scopes: user.scopes,
    pid: user.pid,
    authLvl: user.authLvl,
    ttl: "3600",
  });
  if (user.userId) params.set("userId", user.userId);
  if (user.partyId) params.set("partyId", user.partyId);
  if (user.partyUuid) params.set("partyuuid", user.partyUuid);

  const res = await fetch(`${GENERATOR_URL}?${params}`, {
    headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Token generator svarte ${res.status} for ${config.env}`);
  // Forny i god tid før utløp (ttl 3600 s).
  cached = { token: (await res.text()).trim(), expires: Date.now() + 50 * 60_000 };
  return cached.token;
}

// Alle hemmelige verdier som aldri skal tilbake til modellen.
export function secretsToRedact(): string[] {
  return [cached?.token, process.env.TOKEN_GENERATOR_PASSWORD, ...config.secrets].filter(
    (v): v is string => Boolean(v && v.length >= 6),
  );
}
