// All konfigurasjon kommer fra miljøvariabler (.env lokalt, secrets i CI).
// Hemmeligheter leses her og brukes kun av verktøyene - de sendes aldri til Claude.

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

export const config = {
  model: process.env.QA_MODEL ?? "claude-opus-5-5",
  effort: effort(),
  maxSteps: Number(process.env.QA_MAX_STEPS ?? 40),
  target: {
    baseUrl: new URL(required("TARGET_BASE_URL")),
    appPath: process.env.TARGET_APP_PATH ?? "",
    bearerToken: process.env.TARGET_BEARER_TOKEN || undefined,
    allowDelete: process.env.QA_ALLOW_DELETE === "true",
  },
};
