// Miljøer for Altinn Autorisasjon (altinn-auth). Ingen hemmeligheter her - bare hvor ting bor.
// Samme URL-mønster som altinn-platform-validation-tests og altinn-access-management-frontend.

export const ENVIRONMENTS = {
  at22: { domain: "at22.altinn.cloud" },
  at23: { domain: "at23.altinn.cloud" },
  tt02: { domain: "tt02.altinn.no" },
} as const;

export type EnvName = keyof typeof ENVIRONMENTS;

export function isEnvName(value: string): value is EnvName {
  return value in ENVIRONMENTS;
}

// Innebygde API-er per miljø. Agenten ser navn og beskrivelse, aldri nøkler.
export function builtInApis(env: EnvName) {
  const domain = ENVIRONMENTS[env].domain;
  return {
    platform: {
      baseUrl: `https://platform.${domain}`,
      description:
        "Altinn-plattformen. Viktige stier: /accessmanagement/api/v1/enduser/{connections,authorizedparties,request,clientdelegations}, " +
        "/authorization/api/v1, /authentication/api/v1/{systemuser,systemregister,enduser/systemuser}, " +
        "/register/api/v1/access-management/parties/query, /resourceregistry/api/v1",
    },
    "am-bff": {
      baseUrl: `https://am.ui.${domain}/accessmanagement/api/v1`,
      description:
        "BFF for tilgangsstyring (brukes av frontend). F.eks. /user/profile, /accesspackage, /connection, /consent, /role, " +
        "/singleright, /systemuser, /settings, /reportee, /lookup, /request",
    },
  };
}

// Hard grense for hvilke verter agenten noensinne får kontakte: kun Altinns testmiljøer.
// Dette kan ikke overstyres fra konfig, så agenten kan ikke rettes mot andre nettsteder eller prod.
export function assertAllowedHost(url: URL): void {
  const host = url.hostname.toLowerCase();
  const allowed = Object.values(ENVIRONMENTS).some((e) => host === e.domain || host.endsWith(`.${e.domain}`));
  if (url.protocol !== "https:" || !allowed) {
    throw new Error(`Nekter å bruke ${url.origin} - kun https mot Altinns testmiljøer (at22, at23, tt02) er lov.`);
  }
}
