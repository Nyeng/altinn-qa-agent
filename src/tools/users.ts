import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  addServiceOwner,
  availableCategories,
  describeUser,
  knownUsers,
  pickUser,
  SERVICE_OWNER_SCOPES,
  type TestUser,
} from "../testusers.js";

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

export const useServiceOwnerTool: Anthropic.Beta.BetaTool = {
  name: "use_service_owner",
  description:
    "Opptre som tjenesteeier (virksomhetstoken) i stedet for sluttbruker - trengs f.eks. for å opprette eller " +
    "endre ressurser i ressursregisteret (POST/PUT /resourceregistry/api/v1/resource). TTD (orgnr 991825827) " +
    "eier testressursene. Ressurser du oppretter MÅ ha identifikator som starter med snoken- og ryddes bort etterpå.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      owner: { type: "string", enum: ["ttd"] },
      scopes: { type: "array", items: { type: "string", enum: Object.keys(SERVICE_OWNER_SCOPES) } },
    },
    required: ["owner", "scopes"],
    additionalProperties: false,
  },
};

export function runUseServiceOwner(rawInput: unknown) {
  const parsed = z
    .object({
      owner: z.string(),
      scopes: z.array(z.enum(Object.keys(SERVICE_OWNER_SCOPES) as [keyof typeof SERVICE_OWNER_SCOPES])).min(1),
    })
    .safeParse(rawInput);
  if (!parsed.success) return { content: `Ugyldig input: ${parsed.error.message}`, isError: true };
  try {
    active = addServiceOwner(parsed.data.owner, parsed.data.scopes);
    return { content: `Aktiv bruker er nå ${describeUser(active)}`, isError: false };
  } catch (err) {
    return { content: (err as Error).message, isError: true };
  }
}
