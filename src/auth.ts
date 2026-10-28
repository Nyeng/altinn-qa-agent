// Henter token for valgt miljø fra miljøets JSON-konfig, i prioritert rekkefølge:
//  1. Statisk `token`
//  2. `tokenGenerator` (Altinn test token generator, samme oppsett som k6-testene typisk bruker).
//     Brukernavn/passord er felles for alle miljøer: TOKEN_GENERATOR_USERNAME / TOKEN_GENERATOR_PASSWORD.
//     Sjekk parameterne mot k6-prosjektet deres - de kan avvike.
import { config } from "./config.js";

let cached: string | undefined;

export async function getToken(): Promise<string | undefined> {
  if (cached) return cached;
  if (config.auth.token) return (cached = config.auth.token);

  const gen = config.auth.tokenGenerator;
  const username = process.env.TOKEN_GENERATOR_USERNAME;
  const password = process.env.TOKEN_GENERATOR_PASSWORD;
  if (!gen || config.env === "local") return undefined;
  if (!username || !password) {
    throw new Error("tokenGenerator er satt for miljøet, men TOKEN_GENERATOR_USERNAME/PASSWORD mangler");
  }

  const params = new URLSearchParams({ env: config.env, scopes: gen.scopes, ttl: "3600" });
  if (gen.userId) params.set("userId", gen.userId);
  if (gen.partyId) params.set("partyId", gen.partyId);
  if (gen.pid) params.set("pid", gen.pid);

  const res = await fetch(`${gen.url}?${params}`, {
    headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Token generator svarte ${res.status} for ${config.env}`);
  return (cached = (await res.text()).trim());
}

// Alle hemmelige verdier som aldri skal tilbake til modellen.
export function secretsToRedact(): string[] {
  return [cached, process.env.TOKEN_GENERATOR_PASSWORD, ...config.secrets].filter((v): v is string => Boolean(v && v.length >= 6));
}
