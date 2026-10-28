// Felles innstillinger kommer fra miljøvariabler, alt miljøspesifikt fra én JSON per miljø
// (se env-config.ts). Hemmeligheter brukes kun av verktøyene - de sendes aldri til Claude.
import { loadEnvConfig, secretValues } from "./env-config.js";
import { appBaseUrl, assertNotProduction, isEnvName, type EnvName } from "./environments.js";

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
const envConfig = loadEnvConfig(env);
const baseUrl = appBaseUrl(env, envConfig.org, envConfig.baseUrl);

// "app" er alltid appen som testes; øvrige API-er kommer fra konfigen.
export type ApiTarget = { baseUrl: URL; description: string; headers: Record<string, string>; useToken: boolean };
const apis: Record<string, ApiTarget> = {
  app: {
    baseUrl,
    description: `Altinn-appen som testes (stier starter med /${envConfig.org}/${envConfig.app})`,
    headers: envConfig.headers,
    useToken: true,
  },
};
for (const [name, api] of Object.entries(envConfig.apis)) {
  if (name === "app") throw new Error('API-navnet "app" er reservert');
  apis[name] = { ...api, baseUrl: new URL(api.baseUrl) };
}
for (const api of Object.values(apis)) assertNotProduction(api.baseUrl);

export const config = {
  model: process.env.QA_MODEL ?? "claude-opus-5-5",
  effort: effort(),
  maxSteps: envConfig.maxSteps ?? Number(process.env.QA_MAX_STEPS ?? 40),
  env,
  target: {
    baseUrl,
    appPath: `/${envConfig.org}/${envConfig.app}`,
    allowDelete: envConfig.allowDelete,
    apis,
  },
  auth: {
    token: envConfig.token,
    tokenGenerator: envConfig.tokenGenerator,
  },
  secrets: secretValues(envConfig),
};
