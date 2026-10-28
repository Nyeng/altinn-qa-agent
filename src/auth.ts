// Henter token for valgt miljø. To måter, i prioritert rekkefølge:
//  1. Statisk token per miljø: TOKEN_AT22 / TOKEN_AT23 / TOKEN_TT02 / TOKEN_LOCAL
//  2. Altinn test token generator (samme oppsett som k6-testene typisk bruker):
//     TOKEN_GENERATOR_USERNAME + TOKEN_GENERATOR_PASSWORD + testbrukerens ID-er.
//     Sjekk parameterne mot k6-prosjektet deres - de kan avvike.
import { config } from "./config.js";

const GENERATOR_URL =
  process.env.TOKEN_GENERATOR_URL ?? "https://altinn-testtools-token-generator.azurewebsites.net/api/GetPersonalToken";

let cached: string | undefined;

export async function getToken(): Promise<string | undefined> {
  if (cached) return cached;

  const staticToken = process.env[`TOKEN_${config.env.toUpperCase()}`];
  if (staticToken) return (cached = staticToken);

  const username = process.env.TOKEN_GENERATOR_USERNAME;
  const password = process.env.TOKEN_GENERATOR_PASSWORD;
  if (!username || !password || config.env === "local") return undefined;

  const params = new URLSearchParams({
    env: config.env,
    scopes: process.env.TOKEN_SCOPES ?? "altinn:portal/enduser",
    ttl: "3600",
  });
  for (const [param, envVar] of [
    ["userId", "TEST_USER_ID"],
    ["partyId", "TEST_PARTY_ID"],
    ["pid", "TEST_USER_PID"],
  ] as const) {
    const value = process.env[envVar];
    if (value) params.set(param, value);
  }

  const res = await fetch(`${GENERATOR_URL}?${params}`, {
    headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Token generator svarte ${res.status} for ${config.env}`);
  return (cached = (await res.text()).trim());
}

// Alle hemmelige verdier som aldri skal tilbake til modellen.
export function secretsToRedact(): string[] {
  return [
    cached,
    process.env.TOKEN_GENERATOR_PASSWORD,
    process.env.TEST_USER_PID,
  ].filter((v): v is string => Boolean(v && v.length >= 6));
}
