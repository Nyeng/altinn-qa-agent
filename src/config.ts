// Felles innstillinger kommer fra miljøvariabler, alt miljøspesifikt fra én JSON per miljø
// (se env-config.ts). Hemmeligheter brukes kun av verktøyene - de sendes aldri til Claude.
import { loadEnvConfig, secretValues } from "./env-config.js";
import { assertAllowedHost, builtInApis, ENVIRONMENTS, isEnvName, type EnvName } from "./environments.js";
import { assertAllowedRepository } from "./guard.js";

assertAllowedRepository();

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

function effort(): Effort {
  const value = process.env.QA_EFFORT ?? "low";
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
const cfg = loadEnvConfig(env);

// Hemmelige headere per sti-prefiks (samme fordeling som K6-klientene: register- og authorization-nøkkel).
// `secretName` brukes som plassholder i reproduksjonssteg (curl) - verdien vises aldri.
export type HeaderRule = { pathPrefix: string; headers: Record<string, string>; secretName: string };
export type ApiTarget = { baseUrl: URL; description: string; headerRules: HeaderRule[] };

const SUBSCRIPTION_HEADER = "Ocp-Apim-Subscription-Key";
const builtIn = builtInApis(env);
const platformRules: HeaderRule[] = [];
if (cfg.REGISTER_SUBSCRIPTION_KEY) {
  platformRules.push({
    pathPrefix: "/register/",
    headers: { [SUBSCRIPTION_HEADER]: cfg.REGISTER_SUBSCRIPTION_KEY },
    secretName: "REGISTER_SUBSCRIPTION_KEY",
  });
}
if (cfg.AUTHORIZATION_SUBSCRIPTION_KEY) {
  platformRules.push({
    pathPrefix: "/authorization/",
    headers: { [SUBSCRIPTION_HEADER]: cfg.AUTHORIZATION_SUBSCRIPTION_KEY },
    secretName: "AUTHORIZATION_SUBSCRIPTION_KEY",
  });
}

const apis: Record<string, ApiTarget> = {
  platform: {
    baseUrl: new URL(cfg.BASE_URL ? new URL(cfg.BASE_URL).origin : builtIn.platform.baseUrl),
    description: builtIn.platform.description,
    headerRules: platformRules,
  },
  "am-bff": {
    baseUrl: new URL(
      cfg.AM_UI_BASE_URL ? `${new URL(cfg.AM_UI_BASE_URL).origin}/accessmanagement/api/v1` : builtIn["am-bff"].baseUrl,
    ),
    description: builtIn["am-bff"].description,
    headerRules: [],
  },
};

// Alle verter må være Altinn-testmiljøer, og høre til miljøet som er valgt (ikke en at22-konfig mot tt02).
for (const api of Object.values(apis)) {
  assertAllowedHost(api.baseUrl);
  const domain = ENVIRONMENTS[env].domain;
  if (!api.baseUrl.hostname.endsWith(`.${domain}`)) {
    throw new Error(`Konfigen for ${env} peker til ${api.baseUrl.hostname}, som ikke hører til ${domain}`);
  }
}

export const config = {
  model: process.env.QA_MODEL ?? "claude-sonnet-5-5",
  effort: effort(),
  // Per kjøring (QA_MAX_STEPS i miljøet) > miljøkonfigen > 25
  maxSteps: Number(process.env.QA_MAX_STEPS || cfg.QA_MAX_STEPS || 25),
  // Tak på tokens per økt (inn + cache + ut). Snoken får beskjed om å avslutte når det er nådd.
  maxSessionTokens: Number(process.env.QA_MAX_SESSION_TOKENS ?? 400_000),
  env,
  target: {
    allowDelete: String(cfg.QA_ALLOW_DELETE) === "true",
    apis,
  },
  testUser: {
    pid: cfg.TEST_USER_PID,
    userId: cfg.TEST_USER_ID,
    partyId: cfg.TEST_PARTY_ID,
    partyUuid: cfg.TEST_PARTY_UUID,
    scopes: cfg.TEST_USER_SCOPES,
    authLvl: cfg.TEST_USER_AUTH_LVL,
  },
  secrets: secretValues(cfg),
};
