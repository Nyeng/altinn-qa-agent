// Verktøy for å velge testbrukere etter brukerflyt, bytte mellom dem, og opptre som tjenesteeier.
// Flere brukere i samme økt = tilgangskontrolltesting: når bruker-A bruker-B sine data?
import { z } from "zod";
import { describeUser, SERVICE_OWNERS } from "../altinn/test-users.js";
import type { Session } from "../agent/session.js";
import { defineTool, type Tool } from "./define.js";

export function createUserTools(session: Session): Tool[] {
  const categoryIds = session.users.categories().map((c) => c.id) as [string, ...string[]];
  const scopes = session.allowedScopes as [string, ...string[]];

  const pickTestUser = defineTool({
    name: "pick_test_user",
    description:
      "Hent en ny testbruker fra en kategori (brukerflyt) og gjør den til aktiv bruker. " +
      "Alle videre http_request-kall gjøres som denne brukeren. Returnerer alias og hva du vet om brukeren " +
      "(ID-er, tilknyttet virksomhet, og ev. parter brukeren IKKE skal nå).",
    strict: true,
    input: z.strictObject({ category: z.enum(categoryIds) }),
    label: (i) => `👤 ny bruker fra ${i.category}`,
    run: async ({ category }, s) => ({ content: `Aktiv bruker er nå ${describeUser(await s.users.pick(category))}` }),
  });

  const switchUser = defineTool({
    name: "switch_user",
    description:
      "Bytt aktiv bruker til en du allerede har hentet (f.eks. for å teste om bruker-B når bruker-A sine data).",
    strict: true,
    input: z.strictObject({ alias: z.string().describe("F.eks. bruker-A") }),
    label: (i) => `👤 bytter til ${i.alias}`,
    run: ({ alias }, s) => {
      const user = s.users.activate(alias);
      if (!user) {
        const known =
          s.users
            .all()
            .map((u) => u.alias)
            .join(", ") || "ingen";
        return { content: `Ukjent alias. Kjente: ${known}`, isError: true };
      }
      return { content: `Aktiv bruker er nå ${describeUser(user)}` };
    },
  });

  const useServiceOwner = defineTool({
    name: "use_service_owner",
    description:
      "Opptre som tjenesteeier (virksomhetstoken for TTD, orgnr 991825827) i stedet for sluttbruker - for API-er som " +
      "krever det, f.eks. ressursregisteret, Correspondence eller Dialogporten (serviceowner). Velg scopes fra lista " +
      "(hentet fra altinn-platform-validation-tests). Slå opp med api_reference hvilket token et endepunkt krever. " +
      "Ressurser du oppretter MÅ ha identifikator som starter med snoken- og ryddes bort etterpå.",
    strict: true,
    input: z.strictObject({
      owner: z.enum(Object.keys(SERVICE_OWNERS) as [string, ...string[]]),
      scopes: z.array(z.enum(scopes)),
    }),
    label: (i) => `🏛️ tjenesteeier ${i.owner} (${i.scopes.join(", ")})`,
    run: ({ owner, scopes }, s) => {
      if (scopes.length === 0) return { content: "Oppgi minst ett scope.", isError: true };
      return { content: `Aktiv bruker er nå ${describeUser(s.users.addServiceOwner(owner, scopes))}` };
    },
  });

  return [pickTestUser, switchUser, useServiceOwner];
}
