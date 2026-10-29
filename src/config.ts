// All konfigurasjon leses ett sted, eksplisitt via loadConfig() - ingen sideeffekter ved import.
//   Felles:     miljøvariabler (.env lokalt, secrets i CI)
//   Per miljø:  én JSON i K6-formatet fra altinn-platform-validation-tests
//               (QA_CONFIG_<MILJØ> i CI, ellers configs/<miljø>.json lokalt)
// Hemmeligheter brukes kun av verktøyene - de sendes aldri til Claude.
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { assertAllowedHost, builtInApis, ENVIRONMENTS, isEnvName, type EnvName } from "./policy/environments.js";
import { assertAllowedRepository } from "./policy/guard.js";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

// Hemmelige headere per sti-prefiks (samme fordeling som K6-klientene: register- og authorization-nøkkel).
// `secretName` brukes som plassholder i reproduksjonssteg (curl) - verdien vises aldri.
export type HeaderRule = { pathPrefix: string; headers: Record<string, string>; secretName: string };
export type ApiTarget = { baseUrl: URL; description: string; headerRules: HeaderRule[] };

export type Config = {
  model: string;
  effort: Effort;
  maxSteps: number;
  maxSessionTokens: number;
  env: EnvName;
  allowDelete: boolean;
  apis: Record<string, ApiTarget>;
  testUser: {
    pid?: string;
    userId?: string;
    partyId?: string;
    partyUuid?: string;
    scopes: string;
    authLvl: string;
  };
  tokenGenerator: { username?: string; password?: string };
  testdataBaseUrl: string;
  /** Alle hemmelige verdier fra konfigen - vaskes ut av alt som går tilbake til modellen. */
  secrets: string[];
};

// Miljøkonfig i K6-formatet, pluss testbruker og Son of Vegard-innstillinger. Ukjente nøkler (f.eks. SOAP_ER_*)
// tillates, men alle strengverdier behandles som hemmelige.
const EnvFile = z
  .object({
    BASE_URL: z.string().url().optional(), // https://platform.<miljø>
    AM_UI_BASE_URL: z.string().url().optional(), // https://am.ui.<miljø>
    REGISTER_SUBSCRIPTION_KEY: z.string().optional(), // platform /register/...
    AUTHORIZATION_SUBSCRIPTION_KEY: z.string().optional(), // platform /authorization/...
    TEST_USER_PID: z.string().optional(),
    TEST_USER_ID: z.string().optional(),
    TEST_PARTY_ID: z.string().optional(),
    TEST_PARTY_UUID: z.string().optional(),
    TEST_USER_SCOPES: z.string().default("altinn:portal/enduser"),
    TEST_USER_AUTH_LVL: z.string().default("3"),
    QA_MAX_STEPS: z.coerce.number().int().positive().optional(),
    QA_ALLOW_DELETE: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
  })
  .passthrough();
type EnvFile = z.infer<typeof EnvFile>;

const NOT_SECRET = new Set([
  "BASE_URL",
  "AM_UI_BASE_URL",
  "TEST_USER_SCOPES",
  "TEST_USER_AUTH_LVL",
  "QA_MAX_STEPS",
  "QA_ALLOW_DELETE",
]);
const SUBSCRIPTION_HEADER = "Ocp-Apim-Subscription-Key";

export function loadConfig(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): Config {
  assertAllowedRepository(env);

  const envName = parseEnvName(argv, env);
  const file = readEnvFile(envName, env);
  const apis = buildApis(envName, file);

  return {
    model: env.QA_MODEL || "claude-sonnet-5-5",
    effort: parseEffort(env.QA_EFFORT),
    // Per kjøring (QA_MAX_STEPS i miljøet) > miljøkonfigen > 25
    maxSteps: Number(env.QA_MAX_STEPS || file.QA_MAX_STEPS || 25),
    maxSessionTokens: Number(env.QA_MAX_SESSION_TOKENS || 400_000),
    env: envName,
    allowDelete: String(file.QA_ALLOW_DELETE) === "true",
    apis,
    testUser: {
      pid: file.TEST_USER_PID,
      userId: file.TEST_USER_ID,
      partyId: file.TEST_PARTY_ID,
      partyUuid: file.TEST_PARTY_UUID,
      scopes: file.TEST_USER_SCOPES,
      authLvl: file.TEST_USER_AUTH_LVL,
    },
    tokenGenerator: { username: env.TOKEN_GENERATOR_USERNAME, password: env.TOKEN_GENERATOR_PASSWORD },
    testdataBaseUrl:
      env.QA_TESTDATA_BASE_URL ||
      "https://raw.githubusercontent.com/Altinn/altinn-platform-validation-tests/refs/heads/main",
    secrets: [...secretValues(file), env.TOKEN_GENERATOR_PASSWORD].filter((v): v is string => Boolean(v)),
  };
}

// Miljø velges med --env=at22 på kommandolinjen, ellers QA_ENV.
function parseEnvName(argv: string[], env: NodeJS.ProcessEnv): EnvName {
  const fromArg = argv.find((a) => a.startsWith("--env="))?.slice("--env=".length);
  const value = fromArg ?? env.QA_ENV ?? "at23";
  if (!isEnvName(value)) throw new Error(`Ukjent miljø "${value}" (bruk at22, at23 eller tt02)`);
  return value;
}

function parseEffort(value = "low"): Effort {
  if (!(EFFORTS as readonly string[]).includes(value)) {
    throw new Error(`QA_EFFORT må være en av ${EFFORTS.join(", ")}`);
  }
  return value as Effort;
}

function readEnvFile(envName: EnvName, env: NodeJS.ProcessEnv): EnvFile {
  const varName = `QA_CONFIG_${envName.toUpperCase()}`;
  const path = `configs/${envName}.json`;
  const raw = env[varName] || (existsSync(path) ? readFileSync(path, "utf8") : undefined);
  if (!raw) {
    // Alt er valgfritt: uten konfig brukes standard-URL-er, men kall som krever subscription key feiler.
    console.warn(`ℹ️  Ingen ${varName} / ${path} - kjører uten subscription keys.`);
    return EnvFile.parse({});
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${varName}/${path} er ikke gyldig JSON`); // ikke vis innholdet - det er hemmelig
  }
  const parsed = EnvFile.safeParse(json);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".") || "(rot)").join(", ");
    throw new Error(`Ugyldig konfig for ${envName} - sjekk feltene: ${fields}`);
  }
  maskInGitHubActions(parsed.data, env);
  return parsed.data;
}

function buildApis(envName: EnvName, file: EnvFile): Record<string, ApiTarget> {
  const builtIn = builtInApis(envName);
  const platformRules: HeaderRule[] = [];
  if (file.REGISTER_SUBSCRIPTION_KEY) {
    platformRules.push({
      pathPrefix: "/register/",
      headers: { [SUBSCRIPTION_HEADER]: file.REGISTER_SUBSCRIPTION_KEY },
      secretName: "REGISTER_SUBSCRIPTION_KEY",
    });
  }
  if (file.AUTHORIZATION_SUBSCRIPTION_KEY) {
    platformRules.push({
      pathPrefix: "/authorization/",
      headers: { [SUBSCRIPTION_HEADER]: file.AUTHORIZATION_SUBSCRIPTION_KEY },
      secretName: "AUTHORIZATION_SUBSCRIPTION_KEY",
    });
  }

  const apis: Record<string, ApiTarget> = {
    platform: {
      baseUrl: new URL(file.BASE_URL ? new URL(file.BASE_URL).origin : builtIn.platform.baseUrl),
      description: builtIn.platform.description,
      headerRules: platformRules,
    },
    "am-bff": {
      baseUrl: new URL(
        file.AM_UI_BASE_URL
          ? `${new URL(file.AM_UI_BASE_URL).origin}/accessmanagement/api/v1`
          : builtIn["am-bff"].baseUrl,
      ),
      description: builtIn["am-bff"].description,
      headerRules: [],
    },
  };

  // Alle verter må være Altinn-testmiljøer, og høre til miljøet som er valgt (ikke en at22-konfig mot tt02).
  const domain = ENVIRONMENTS[envName].domain;
  for (const api of Object.values(apis)) {
    assertAllowedHost(api.baseUrl);
    if (!api.baseUrl.hostname.endsWith(`.${domain}`)) {
      throw new Error(`Konfigen for ${envName} peker til ${api.baseUrl.hostname}, som ikke hører til ${domain}`);
    }
  }
  return apis;
}

// Bedre å vaske ut for mye enn for lite - også ukjente nøkler som SOAP_ER_PASSWORD.
function secretValues(file: EnvFile): string[] {
  return Object.entries(file)
    .filter(([key, value]) => !NOT_SECRET.has(key) && typeof value === "string" && value.length >= 4)
    .map(([, value]) => value as string);
}

// GitHub maskerer hele secret-strengen, men ikke enkeltfelt inni JSON-en.
function maskInGitHubActions(file: EnvFile, env: NodeJS.ProcessEnv) {
  if (env.GITHUB_ACTIONS !== "true") return;
  for (const value of [...secretValues(file), env.TOKEN_GENERATOR_PASSWORD]) {
    if (value) console.log(`::add-mask::${value}`);
  }
}
