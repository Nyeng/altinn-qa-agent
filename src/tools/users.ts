import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { availableCategories, describeUser, knownUsers, pickUser, type TestUser } from "../testusers.js";

// Verktøy for å velge testbrukere etter brukerflyt og bytte mellom dem.
// Flere brukere i samme økt = tilgangskontrolltesting: kan bruker-A se/endre bruker-B sine data?

let active: TestUser | undefined;

export function activeUser(): TestUser | undefined {
  return active;
}

export function setActiveUser(user: TestUser) {
  active = user;
}

const categoryIds = availableCategories().map((c) => c.id);

export const pickTestUserTool: Anthropic.Beta.BetaTool = {
  name: "pick_test_user",
  description:
    "Hent en ny testbruker fra en kategori (brukerflyt) og gjør den til aktiv bruker. " +
    "Alle videre http_request-kall gjøres som denne brukeren. Returnerer alias og hva du vet om brukeren " +
    "(ID-er, tilknyttet virksomhet, og ev. parter brukeren IKKE skal nå).",
  strict: true,
  input_schema: {
    type: "object",
    properties: { category: { type: "string", enum: categoryIds } },
    required: ["category"],
    additionalProperties: false,
  },
};

export const switchUserTool: Anthropic.Beta.BetaTool = {
  name: "switch_user",
  description: "Bytt aktiv bruker til en du allerede har hentet (f.eks. for å teste om bruker-B når bruker-A sine data).",
  strict: true,
  input_schema: {
    type: "object",
    properties: { alias: { type: "string", description: "F.eks. bruker-A" } },
    required: ["alias"],
    additionalProperties: false,
  },
};

export async function runPickTestUser(rawInput: unknown) {
  const parsed = z.object({ category: z.string() }).safeParse(rawInput);
  if (!parsed.success) return { content: `Ugyldig input: ${parsed.error.message}`, isError: true };
  try {
    const user = await pickUser(parsed.data.category);
    active = user;
    return { content: `Aktiv bruker er nå ${describeUser(user)}`, isError: false };
  } catch (err) {
    return { content: (err as Error).message, isError: true };
  }
}

export function runSwitchUser(rawInput: unknown) {
  const parsed = z.object({ alias: z.string() }).safeParse(rawInput);
  if (!parsed.success) return { content: `Ugyldig input: ${parsed.error.message}`, isError: true };
  const user = knownUsers().find((u) => u.alias === parsed.data.alias);
  if (!user) {
    return { content: `Ukjent alias. Kjente: ${knownUsers().map((u) => u.alias).join(", ") || "ingen"}`, isError: true };
  }
  active = user;
  return { content: `Aktiv bruker er nå ${describeUser(user)}`, isError: false };
}
