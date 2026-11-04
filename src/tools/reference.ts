// api_reference: slår opp hvordan et Altinn-API brukes, fra K6-klientene i altinn-platform-validation-tests.
// Kunnskapen leses fra GitHub ved bruk - ingenting er kopiert inn i dette repoet.
import { z } from "zod";
import { defineTool } from "./define.js";

export const apiReference = defineTool({
  name: "api_reference",
  countsAsStep: false,
  description:
    "Slå opp hvordan et Altinn-API brukes: metoder, HTTP-metode og sti, parametre og hvilket token som kreves. " +
    "Kilden er K6-klientene i altinn-platform-validation-tests, som dekker alle produktene (access-management, " +
    "authorization, authentication, resource-registry, register, dialogporten, correspondence, storage, events, " +
    "profil, notifications, broker m.fl.). Søk med område eller stikkord, f.eks. 'access-management request', " +
    "'dialogporten serviceowner' eller 'correspondence'. Bruk dette før du gjetter stier og parametre.",
  input: z.strictObject({ query: z.string().describe("Område eller stikkord") }),
  label: (i) => `📚 api_reference ${i.query}`,
  run: async ({ query }, s) => ({ content: await s.knowledge.reference(query) }),
});

export const knownIssues = defineTool({
  name: "known_issues",
  countsAsStep: false,
  description:
    "Søk etter issues i Altinn/altinn-auth (åpne og lukkede) før du rapporterer et funn, så kjente bugs ikke meldes " +
    "som nye. Søk med endepunkt, feilkode eller stikkord fra funnet, gjerne flere varianter (f.eks. " +
    "'activitylog next', 'activitylog internal'). Finner du samme feil, oppgi nummeret i knownIssue i report_finding.",
  input: z.strictObject({ query: z.string().describe("Stikkord, f.eks. endepunkt og symptom") }),
  label: (i) => `🔎 known_issues ${i.query}`,
  run: async ({ query }, s) => ({ content: await s.knowledge.knownIssues(query) }),
});
