// Én JSON-konfig per miljø, i samme format som K6-miljøene i altinn-platform-validation-tests,
// pluss testbrukeren Snoken skal opptre som.
//   CI:     secret QA_CONFIG_AT22 / QA_CONFIG_AT23 / QA_CONFIG_TT02 (hele JSON-en som verdi)
//   Lokalt: configs/at22.json osv. (gitignored) - se configs/example.json
// Miljøvariabelen vinner over filen hvis begge finnes. Ukjente nøkler (f.eks. SOAP_ER_*) ignoreres,
// men alle strengverdier behandles som hemmelige og maskeres/vaskes ut.
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { EnvName } from "./environments.js";

const EnvConfig = z
  .object({
    // Fra K6-oppsettet. Utelates de, brukes standard-URL-ene for miljøet.
    BASE_URL: z.string().url().optional(), // https://platform.<miljø>
    AM_UI_BASE_URL: z.string().url().optional(), // https://am.ui.<miljø>
    REGISTER_SUBSCRIPTION_KEY: z.string().optional(), // brukes for platform /register/...
    AUTHORIZATION_SUBSCRIPTION_KEY: z.string().optional(), // brukes for platform /authorization/...

    // Valgfri egen testbruker. Ellers velger Snoken brukere fra platform-validation-tests (testdata-catalog.ts).
    TEST_USER_PID: z.string().optional(),
    TEST_USER_ID: z.string().optional(),
    TEST_PARTY_ID: z.string().optional(),
    TEST_PARTY_UUID: z.string().optional(),
    TEST_USER_SCOPES: z.string().default("altinn:portal/enduser"),
    TEST_USER_AUTH_LVL: z.string().default("3"),

    // Snoken-innstillinger
    QA_MAX_STEPS: z.coerce.number().int().positive().optional(),
    QA_ALLOW_DELETE: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
  })
  .passthrough();

export type EnvConfig = z.infer<typeof EnvConfig>;

export function loadEnvConfig(env: EnvName): EnvConfig {
  const varName = `QA_CONFIG_${env.toUpperCase()}`;
  const file = `configs/${env}.json`;
  const raw = process.env[varName] || (existsSync(file) ? readFileSync(file, "utf8") : undefined);
  if (!raw) {
    // Alt er valgfritt: uten konfig brukes standard-URL-er og testbrukere fra platform-validation-tests,
    // men kall som krever subscription key (register/authorization) vil feile.
    console.warn(`ℹ️  Ingen ${varName} / ${file} - kjører uten subscription keys.`);
    return EnvConfig.parse({});
  }

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

// Alt som er hemmelig: alle strengverdier unntatt URL-er og ikke-sensitive innstillinger.
// (Bedre å vaske ut for mye enn for lite - også ukjente nøkler som SOAP_ER_PASSWORD.)
const NOT_SECRET = new Set(["BASE_URL", "AM_UI_BASE_URL", "TEST_USER_SCOPES", "TEST_USER_AUTH_LVL", "QA_MAX_STEPS", "QA_ALLOW_DELETE"]);

export function secretValues(cfg: EnvConfig): string[] {
  return Object.entries(cfg)
    .filter(([key, value]) => !NOT_SECRET.has(key) && typeof value === "string" && value.length >= 4)
    .map(([, value]) => value as string);
}
