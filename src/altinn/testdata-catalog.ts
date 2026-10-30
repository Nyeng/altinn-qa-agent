// Katalog over testbrukere i Altinn/altinn-platform-validation-tests, gruppert etter brukerflyt.
// Hver kategori peker til CSV-filer (per miljø) og sier hvilke kolonner som er hvem.
// Kun at22/at23/tt02 - prod-filer i repoet brukes aldri.
import type { EnvName } from "../policy/environments.js";

type Source = {
  // Sti relativt til repo-roten. {env} erstattes med miljønavnet.
  path: string;
  envs: EnvName[];
};

export type Category = {
  id: string;
  name: string;
  flow: string; // hva brukerne er laget for, i én setning
  sources: Source[];
  // Kolonner for den som logger inn (pid er hemmelig og vises aldri for Son of Vegard).
  pid: string;
  userId?: string;
  partyId?: string;
  partyUuid?: string; // brukerens egen partyUuid - sendes til token generator
  // Andre kolonner Son of Vegard får se, med forklaring (f.eks. parter brukeren IKKE skal nå).
  context: Record<string, string>;
  // Hvordan testdata som ikke ligger ferdig i datasettet, settes opp (vises i prompten).
  setup?: string;
};

const K6 = "K6/testdata";
const PW = "playwright/testdata";
const ALL: EnvName[] = ["at22", "at23", "tt02"];
const AT23_TT02: EnvName[] = ["at23", "tt02"];

// Felles kolonneoppsett for BFF-datasettene (orgNo,partyId,ssn,userId,userPartyId,orgUuid,partyUuid,lastName)
const BFF_USER = { pid: "ssn", userId: "userId", partyId: "userPartyId", partyUuid: "partyUuid" };
const BFF_CONTEXT = {
  lastName: "etternavn",
  orgNo: "tilknyttet virksomhet (orgnr)",
  orgUuid: "virksomhetens partyUuid",
  partyId: "virksomhetens partyId",
};

export const CATEGORIES: Category[] = [
  {
    id: "tilgangspakker-person",
    name: "Tilgangspakker person→person",
    flow: "Personer som gir og mottar tilgangspakker fra/til andre personer.",
    sources: [{ path: `${K6}/access-management-bff/access-packages/user-to-user/{env}.csv`, envs: AT23_TT02 }],
    ...BFF_USER,
    context: BFF_CONTEXT,
  },
  {
    id: "tilgangspakker-virksomhet",
    name: "Tilgangspakker virksomhet→virksomhet",
    flow: "Personer som representerer en virksomhet og delegerer tilgangspakker til andre virksomheter.",
    sources: [{ path: `${K6}/access-management-bff/access-packages/org-to-org/{env}.csv`, envs: AT23_TT02 }],
    ...BFF_USER,
    context: BFF_CONTEXT,
  },
  {
    id: "enkeltrettigheter",
    name: "Enkeltrettigheter (enkelttjenester)",
    flow: "Delegering av enkeltrettigheter til tjenester, både person→person og virksomhet→virksomhet.",
    sources: [
      { path: `${K6}/access-management-bff/single-rights/{env}/user-user.csv`, envs: AT23_TT02 },
      { path: `${K6}/access-management-bff/single-rights/{env}/org-org.csv`, envs: AT23_TT02 },
    ],
    ...BFF_USER,
    context: BFF_CONTEXT,
  },
  {
    id: "instansdelegering",
    name: "Instansdelegering",
    flow: "Delegering av tilgang til enkeltinstanser (f.eks. ett skjema), person→person og virksomhet→person.",
    sources: [
      { path: `${K6}/access-management-bff/instance-delegation/{env}/user-user.csv`, envs: AT23_TT02 },
      { path: `${K6}/access-management-bff/instance-delegation/{env}/org-user.csv`, envs: AT23_TT02 },
    ],
    ...BFF_USER,
    context: BFF_CONTEXT,
  },
  {
    id: "klientadministrasjon",
    setup:
      "Klientrelasjoner finnes ikke ferdig i testdataene (clientUuid/agentUuid er tomme med vilje) - sett dem opp " +
      "slik K6 gjør (client-delegations-v2/delegate-and-remove-resource.js, setUpClientRelation): hent en ANNEN " +
      "bruker fra kategorien som klient, og som den brukeren: POST connections?party=<klientens orgUuid>&to=<firmaets " +
      "orgUuid>, finn delegerbar read-rettighet med delegationcheck, og deleger ressursen (CreateResourceRights). " +
      "Da står klienten hos firmaet med rollen rettighetshaver. Agenter: kategorien klient-agent. " +
      'Slå opp endepunktene med api_reference "access-management connections" og "client-delegation".',
    name: "Klientadministrasjon (regnskapsfører/revisor)",
    flow: "Brukere i firma med klientforhold - delegerer klienttilganger til ansatte (agenter).",
    sources: [
      { path: `${K6}/access-management-bff/client-admin/open-client-admin/{env}.csv`, envs: AT23_TT02 },
      { path: `${K6}/access-management/enduser/client-delegations-v2/{env}.csv`, envs: ALL },
    ],
    pid: "pid|ssn",
    userId: "userId",
    partyId: "userPartyId|partyId",
    partyUuid: "partyUuid",
    context: {
      lastName: "etternavn",
      orgNo: "firmaets orgnr",
      orgUuid: "firmaets partyUuid",
      orgName: "firmaets navn",
      clientUuid: "en klient firmaet har",
      agentUuid: "en agent (ansatt) i firmaet",
      roleCode: "klientrolle",
      resource: "ressurs knyttet til klientforholdet",
    },
  },
  {
    id: "klient-agent",
    name: "Agent (ansatt hos regnskapsfører)",
    flow: "Ansatte som kan få klienttilganger delegert fra firmaet sitt.",
    sources: [{ path: `${K6}/access-management/enduser/client-delegations-v2/agents/{env}.csv`, envs: ALL }],
    pid: "pid",
    userId: "userId",
    partyId: "partyId",
    partyUuid: "partyUuid",
    context: { lastName: "etternavn", name: "navn" },
  },
  {
    id: "samtykke",
    name: "Samtykke",
    flow: "Personer som gir samtykke til at virksomheter får tilgang til data om dem.",
    sources: [
      { path: `${K6}/access-management-bff/consent/{env}.csv`, envs: AT23_TT02 },
      { path: `${K6}/access-management/consent/consenter-persons/{env}.csv`, envs: ALL },
    ],
    pid: "ssn",
    userId: "userId",
    partyId: "userPartyId|partyId",
    partyUuid: "partyUuid",
    context: { lastName: "etternavn", orgNo: "tilknyttet virksomhet (orgnr)", orgUuid: "virksomhetens partyUuid" },
  },
  {
    id: "forespørsler",
    name: "Tilgangsforespørsler",
    flow: "Brukere som ber om eller behandler forespørsler om tilgang.",
    sources: [{ path: `${K6}/access-management/enduser/request/{env}.csv`, envs: ALL }],
    pid: "pid",
    userId: "userId",
    partyId: "partyId",
    partyUuid: "partyUuid",
    context: { lastName: "etternavn", orgNo: "tilknyttet virksomhet (orgnr)", orgUuid: "virksomhetens partyUuid" },
  },
  {
    id: "aktivitetslogg",
    name: "Aktivitetslogg",
    flow: "Brukere med historikk i aktivitetsloggen (hvem har gitt/fått hva, når).",
    sources: [{ path: `${K6}/access-management/enduser/activity-log/{env}.csv`, envs: ["at22", "at23"] }],
    pid: "pid",
    partyUuid: "partyUuid",
    context: { lastName: "etternavn", orgNo: "tilknyttet virksomhet (orgnr)", orgUuid: "virksomhetens partyUuid" },
  },
  {
    id: "partsstruktur-grenser",
    name: "Kompliserte partsstrukturer og grenser",
    flow:
      "Brukere med firma, underenheter, klienter og nøkkelroller - og parter de IKKE skal nå. " +
      "Gull for tilgangskontroll: prøv å nå unreachablePartyUuid.",
    sources: [
      { path: `${K6}/access-management/resource-owner/authorized-parties/party-filter/{env}.csv`, envs: ALL },
      {
        path: `${K6}/access-management/resource-owner/authorized-parties/clients-and-key-role-parties/{env}.csv`,
        envs: ALL,
      },
      { path: `${K6}/access-management/resource-owner/authorized-parties/key-role-filter/{env}.csv`, envs: ALL },
    ],
    pid: "pid",
    context: {
      orgno: "brukerens firma (orgnr)",
      firmPartyUuid: "brukerens firma",
      firmSubunitPartyUuid: "underenhet av firmaet",
      clientOrgno: "en klient (orgnr)",
      clientPartyUuid: "en klient brukeren skal nå",
      clientSubunitPartyUuid: "underenhet av klienten",
      innehaverPartyUuid: "innehaver",
      keyRoleOnlyPartyUuid: "part brukeren kun har nøkkelrolle for",
      directDelegatorPartyUuid: "part som har delegert direkte til brukeren",
      directDelegatorPackage: "pakken som ble delegert direkte",
      unreachablePartyUuid: "⚠️ part brukeren IKKE skal kunne nå",
    },
  },
  {
    id: "systembruker",
    name: "Systembruker",
    flow: "Personer med rolle i en virksomhet som godkjenner systembrukere og endringsforespørsler fra leverandører.",
    sources: [
      { path: `${K6}/authentication/system-user-request/{env}.csv`, envs: ALL },
      { path: `${K6}/authentication/system-user-client-delegation/{env}.csv`, envs: ALL },
      { path: `${K6}/authentication/change-request-system-user/end-users-{env}.csv`, envs: ALL },
    ],
    pid: "ssn|userPid",
    userId: "userId",
    partyUuid: "userPartyUuid",
    context: {
      orgNo: "virksomhet (orgnr)",
      orgUuid: "virksomhetens partyUuid",
      orgPartyUuid: "virksomhetens partyUuid",
      orgType: "organisasjonsform",
      role: "brukerens rolle i virksomheten",
    },
  },
  {
    id: "daglig-leder",
    name: "Daglig leder",
    flow: "Daglige ledere - har normalt bred tilgang på vegne av virksomheten sin.",
    sources: [
      { path: `${K6}/authorization/pdp-authorize/orgs-dagl-{env}.csv`, envs: ["at22", "tt02"] },
      { path: `${PW}/dagligLeder/{env}.csv`, envs: ["tt02"] },
    ],
    pid: "ssn|pid",
    context: { orgno: "virksomheten vedkommende er daglig leder i", last_name: "etternavn" },
  },
  {
    id: "privatperson",
    name: "Privatperson uten virksomhet",
    flow: "Vanlige innbyggere uten roller i virksomheter - godt utgangspunkt for 'skal ikke ha tilgang'-tester.",
    sources: [{ path: `${PW}/privatPersonUtenVirksomhet/{env}.csv`, envs: AT23_TT02 }],
    pid: "pid",
    context: { last_name: "etternavn" },
  },
];

export function categoriesFor(env: EnvName): Category[] {
  return CATEGORIES.filter((c) => c.sources.some((s) => s.envs.includes(env)));
}
