// Miljøfila: alt som hører til ett testmiljø, sjekket inn i environments/<miljø>.json.
//   secrets     referanser til hemmeligheter ("$env:NAVN"), aldri verdiene - de leses fra miljøet (.env / CI)
//   testUsers   faste, syntetiske testbrukere med navn, så tester kan gjentas og rapporter peker på det samme
//   resources   faste testressurser, med RightKeys per action
//   flags       flaggstatus slik den sist ble bekreftet, med dato og hvordan
//   limits      stegbudsjett og DELETE-regel for agenten
// Fila erstatter ikke K6-konfigen (configs/<miljø>.json / QA_CONFIG_<MILJØ>): den leses fortsatt, og verdiene der
// vinner over $env-referansene, så CI virker uendret.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { EnvName } from "./policy/environments.js";

const SECRET_REF = /^\$env:([A-Z][A-Z0-9_]*)$/;

const Org = z.strictObject({
  orgNo: z.string().regex(/^\d{9}$/),
  partyUuid: z.string().uuid().optional(),
  name: z.string().optional(),
  role: z.string().optional().describe("Brukerens rolle i virksomheten, f.eks. daglig leder"),
});

const FixedUser = z.strictObject({
  description: z.string().describe("Hva brukeren brukes til, og hvordan den henger sammen med de andre"),
  pid: z.string().regex(/^\d{11}$/),
  userId: z.string().optional(),
  partyId: z.string().optional(),
  partyUuid: z.string().uuid().optional(),
  lastName: z.string().optional(),
  org: Org.optional(),
});

const Resource = z.strictObject({
  description: z.string().optional(),
  rightKeys: z.record(z.string(), z.string().regex(/^01[0-9a-f]{64}$/)).optional(),
});

const Flag = z.strictObject({
  on: z.boolean(),
  checked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  how: z.string().optional().describe("Hvordan statusen ble bekreftet"),
});

export const EnvironmentFile = z.strictObject({
  env: z.string(),
  secrets: z
    .record(z.string(), z.string().regex(SECRET_REF, 'Hemmeligheter skal være "$env:NAVN", aldri verdier'))
    .default({}),
  testUsers: z
    .record(
      z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9-]*$/)
        .refine((n) => !n.startsWith("bruker-"), "bruker-* er reservert for brukerpoolen"),
      FixedUser,
    )
    .default({}),
  serviceOwner: z.strictObject({ org: z.string(), orgNo: z.string().regex(/^\d{9}$/) }).optional(),
  resources: z.record(z.string(), Resource).default({}),
  flags: z.record(z.string(), Flag).default({}),
  limits: z
    .strictObject({ maxSteps: z.number().int().positive().optional(), allowDelete: z.boolean().optional() })
    .default({}),
});
export type EnvironmentFile = z.infer<typeof EnvironmentFile>;
export type FixedUser = z.infer<typeof FixedUser>;

export type LoadedEnvironment = {
  file: EnvironmentFile;
  /** Hemmelighetene fra secrets, slått opp i miljøet. Mangler en variabel, er verdien utelatt. */
  secrets: Record<string, string>;
  /** Hemmeligheter der miljøvariabelen ikke er satt: nøkkel → variabelnavn. */
  missing: Record<string, string>;
};

/** Leser environments/<miljø>.json. Uten fil gis en tom miljøfil, så alt fungerer som før. */
export function loadEnvironment(
  envName: EnvName,
  env: NodeJS.ProcessEnv,
  dir = env.QA_ENVIRONMENTS_DIR || "environments",
): LoadedEnvironment {
  const file = path.join(dir, `${envName}.json`);
  if (!existsSync(file)) return { file: EnvironmentFile.parse({ env: envName }), secrets: {}, missing: {} };

  const parsed = EnvironmentFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`Ugyldig ${file}:\n${z.prettifyError(parsed.error)}`);
  if (parsed.data.env !== envName) throw new Error(`${file} er for ${parsed.data.env}, ikke ${envName}`);

  const secrets: Record<string, string> = {};
  const missing: Record<string, string> = {};
  for (const [key, ref] of Object.entries(parsed.data.secrets)) {
    const variable = SECRET_REF.exec(ref)![1];
    const value = env[variable];
    if (value) secrets[key] = value;
    else missing[key] = variable;
  }
  return { file: parsed.data, secrets, missing };
}
