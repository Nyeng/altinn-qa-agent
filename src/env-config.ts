// Én JSON-konfig per miljø, med alt som hører til miljøet (inkl. hemmeligheter).
//   CI:     secret QA_CONFIG_AT22 / QA_CONFIG_AT23 / QA_CONFIG_TT02 (hele JSON-en som verdi)
//   Lokalt: configs/at22.json osv. (gitignored) - se configs/example.json
// Miljøvariabelen vinner over filen hvis begge finnes.
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { EnvName } from "./environments.js";

const Headers = z.record(z.string(), z.string()).default({});

const EnvConfig = z.object({
  // Testbrukeren agenten opptrer som. Token hentes fra Altinn test token generator
  // (GetPersonalToken, samme som platform-validation-tests). Brukernavn/passord er felles:
  // TOKEN_GENERATOR_USERNAME / TOKEN_GENERATOR_PASSWORD.
  testUser: z.object({
    pid: z.string(),
    userId: z.string().optional(),
    partyId: z.string().optional(),
    partyUuid: z.string().optional(),
    scopes: z.string().default("altinn:portal/enduser"),
    authLvl: z.string().default("3"),
  }),
  // Hemmelige headere per API, f.eks. { "platform": { "Ocp-Apim-Subscription-Key": "..." } }
  apiHeaders: z.record(z.string(), Headers).default({}),
  // Ekstra API-er (må ligge i et Altinn-testmiljø - håndheves i koden).
  apis: z
    .record(
      z.string().regex(/^[a-z][a-z0-9-]*$/, "API-navn: små bokstaver, tall og bindestrek"),
      z.object({ baseUrl: z.string().url(), description: z.string().default(""), headers: Headers }),
    )
    .default({}),
  maxSteps: z.number().int().positive().optional(),
  allowDelete: z.boolean().default(false),
});

export type EnvConfig = z.infer<typeof EnvConfig>;

export function loadEnvConfig(env: EnvName): EnvConfig {
  const varName = `QA_CONFIG_${env.toUpperCase()}`;
  const file = `configs/${env}.json`;
  const raw = process.env[varName] || (existsSync(file) ? readFileSync(file, "utf8") : undefined);
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

// Alle hemmelige verdier i konfigen: PID og alle header-verdier.
export function secretValues(cfg: EnvConfig): string[] {
  return [
    cfg.testUser.pid,
    ...Object.values(cfg.apiHeaders).flatMap((h) => Object.values(h)),
    ...Object.values(cfg.apis).flatMap((api) => Object.values(api.headers)),
  ].filter((v): v is string => Boolean(v));
}
