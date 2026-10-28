// Én JSON-konfig per miljø, med alt som hører til miljøet (inkl. hemmeligheter).
//   CI:     secret QA_CONFIG_AT22 / QA_CONFIG_AT23 / QA_CONFIG_TT02 (hele JSON-en som verdi)
//   Lokalt: configs/at22.json osv. (gitignored) - se configs/example.json
// Miljøvariabelen vinner over filen hvis begge finnes.
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { EnvName } from "./environments.js";

const EnvConfig = z.object({
  org: z.string(),
  app: z.string(),
  // Kun for local (app-localtest). For at22/at23/tt02 utledes URL-en fra org.
  baseUrl: z.string().url().optional(),
  // Alternativ 1: statisk token
  token: z.string().optional(),
  // Alternativ 2: Altinn test token generator - sjekk feltene mot k6-oppsettet deres.
  // Brukernavn/passord er felles for alle miljøer og hentes fra TOKEN_GENERATOR_USERNAME/PASSWORD.
  tokenGenerator: z
    .object({
      url: z.string().url().default("https://altinn-testtools-token-generator.azurewebsites.net/api/GetPersonalToken"),
      scopes: z.string().default("altinn:portal/enduser"),
      userId: z.string().optional(),
      partyId: z.string().optional(),
      pid: z.string().optional(),
    })
    .optional(),
  // Hemmelige headere som legges på alle kall til appen (f.eks. API-nøkler).
  headers: z.record(z.string(), z.string()).default({}),
  // Andre API-er agenten får teste, med navn. Agenten ser kun navn og beskrivelse.
  apis: z
    .record(
      z.string().regex(/^[a-z][a-z0-9-]*$/, "API-navn: små bokstaver, tall og bindestrek"),
      z.object({
        baseUrl: z.string().url(),
        description: z.string().default(""),
        headers: z.record(z.string(), z.string()).default({}),
        useToken: z.boolean().default(true), // legg på Altinn-token (Bearer) også her?
      }),
    )
    .default({}),
  maxSteps: z.number().int().positive().optional(),
  allowDelete: z.boolean().default(false),
});

export type EnvConfig = z.infer<typeof EnvConfig>;

export function loadEnvConfig(env: EnvName): EnvConfig {
  const varName = `QA_CONFIG_${env.toUpperCase()}`;
  const file = `configs/${env}.json`;
  const raw = process.env[varName] ?? (existsSync(file) ? readFileSync(file, "utf8") : undefined);
  if (!raw) throw new Error(`Fant ingen konfig for ${env}: sett ${varName} eller lag ${file} (se configs/example.json)`);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Ikke vis innholdet - det inneholder hemmeligheter.
    throw new Error(`${varName}/${file} er ikke gyldig JSON`);
  }
  const parsed = EnvConfig.safeParse(json);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".") || "(rot)").join(", ");
    throw new Error(`Ugyldig konfig for ${env} - sjekk feltene: ${fields}`);
  }

  maskInGitHubActions(parsed.data);
  return parsed.data;
}

// GitHub maskerer hele secret-strengen, men ikke enkeltfelt inni JSON-en.
// Registrer hvert hemmelige felt så det aldri vises i loggen.
function maskInGitHubActions(cfg: EnvConfig) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  for (const value of [...secretValues(cfg), process.env.TOKEN_GENERATOR_PASSWORD]) {
    if (value) console.log(`::add-mask::${value}`);
  }
}

// Alle hemmelige verdier i konfigen: token, PID og alle header-verdier.
export function secretValues(cfg: EnvConfig): string[] {
  return [
    cfg.token,
    cfg.tokenGenerator?.pid,
    ...Object.values(cfg.headers),
    ...Object.values(cfg.apis).flatMap((api) => Object.values(api.headers)),
  ].filter((v): v is string => Boolean(v));
}
