// All konfigurasjon kommer fra miljøvariabler (.env lokalt, secrets i CI).
// Hemmeligheter leses her og brukes kun av verktøyene - de sendes aldri til Claude.
import { appBaseUrl, assertNotProduction, isEnvName, type EnvName } from "./environments.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Mangler miljøvariabel ${name} (se .env.example)`);
  return value;
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

function effort(): Effort {
  const value = process.env.QA_EFFORT ?? "medium";
  if (!(EFFORTS as readonly string[]).includes(value)) {
    throw new Error(`QA_EFFORT må være en av ${EFFORTS.join(", ")}`);
  }
  return value as Effort;
}

// Miljø velges med --env=at22 på kommandolinjen, ellers QA_ENV.
function envName(): EnvName {
  const fromArg = process.argv.find((a) => a.startsWith("--env="))?.slice("--env=".length);
  const value = fromArg ?? process.env.QA_ENV ?? "local";
  if (!isEnvName(value)) throw new Error(`Ukjent miljø "${value}" (bruk at22, at23, tt02 eller local)`);
  return value;
}

const env = envName();
const org = env === "local" ? (process.env.ALTINN_ORG ?? "ttd") : required("ALTINN_ORG");
const app = required("ALTINN_APP");
const baseUrl = appBaseUrl(env, org, process.env.TARGET_BASE_URL);
assertNotProduction(baseUrl);

export const config = {
  model: process.env.QA_MODEL ?? "claude-opus-5-5",
  effort: effort(),
  maxSteps: Number(process.env.QA_MAX_STEPS ?? 40),
  env,
  target: {
    baseUrl,
    appPath: `/${org}/${app}`,
    allowDelete: process.env.QA_ALLOW_DELETE === "true",
  },
};
