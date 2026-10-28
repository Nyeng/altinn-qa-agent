// Felles innstillinger kommer fra miljøvariabler, alt miljøspesifikt fra én JSON per miljø
// (se env-config.ts). Hemmeligheter brukes kun av verktøyene - de sendes aldri til Claude.
import { loadEnvConfig, secretValues } from "./env-config.js";
import { assertAllowedHost, builtInApis, isEnvName, type EnvName } from "./environments.js";
import { assertAllowedRepository } from "./guard.js";

assertAllowedRepository();

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
  const value = fromArg ?? process.env.QA_ENV ?? "at23";
  if (!isEnvName(value)) throw new Error(`Ukjent miljø "${value}" (bruk at22, at23 eller tt02)`);
  return value;
}

const env = envName();
const envConfig = loadEnvConfig(env);

export type ApiTarget = { baseUrl: URL; description: string; headers: Record<string, string> };
const apis: Record<string, ApiTarget> = {};
for (const [name, api] of Object.entries(builtInApis(env))) {
  apis[name] = { ...api, baseUrl: new URL(api.baseUrl), headers: envConfig.apiHeaders[name] ?? {} };
}
for (const [name, api] of Object.entries(envConfig.apis)) {
  if (name in apis) throw new Error(`API-navnet "${name}" er innebygd - bruk apiHeaders for å gi det nøkler`);
  apis[name] = { ...api, baseUrl: new URL(api.baseUrl) };
}
for (const api of Object.values(apis)) assertAllowedHost(api.baseUrl);

export const config = {
  model: process.env.QA_MODEL ?? "claude-opus-5-5",
  effort: effort(),
  maxSteps: envConfig.maxSteps ?? Number(process.env.QA_MAX_STEPS ?? 40),
  env,
  target: {
    allowDelete: envConfig.allowDelete,
    apis,
  },
  testUser: envConfig.testUser,
  secrets: secretValues(envConfig),
};
