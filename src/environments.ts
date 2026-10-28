// Miljøprofiler for Altinn 3. Ingen hemmeligheter her - bare hvor appen bor.
// App-URL-er følger mønsteret https://{org}.apps.{miljø-domene}/{org}/{app}

export const ENVIRONMENTS = {
  at22: { appsDomain: "apps.at22.altinn.cloud", description: "Altinn testmiljø AT22" },
  at23: { appsDomain: "apps.at23.altinn.cloud", description: "Altinn testmiljø AT23" },
  tt02: { appsDomain: "apps.tt02.altinn.no", description: "Altinn TT02 (tjenesteeiertest)" },
  local: { appsDomain: "", description: "app-localtest (bruker TARGET_BASE_URL)" },
} as const;

export type EnvName = keyof typeof ENVIRONMENTS;

export function isEnvName(value: string): value is EnvName {
  return value in ENVIRONMENTS;
}

export function appBaseUrl(env: EnvName, org: string, localBaseUrl?: string): URL {
  if (env === "local") {
    if (!localBaseUrl) throw new Error("QA_ENV=local krever TARGET_BASE_URL (f.eks. http://local.altinn.cloud)");
    return new URL(localBaseUrl);
  }
  return new URL(`https://${org}.${ENVIRONMENTS[env].appsDomain}`);
}

// Prod-sperre: alt under altinn.no som ikke er tt02 regnes som produksjon.
export function assertNotProduction(url: URL): void {
  const host = url.hostname.toLowerCase();
  const isAltinnNo = host === "altinn.no" || host.endsWith(".altinn.no");
  if (isAltinnNo && !host.includes(".tt02.")) {
    throw new Error(`Nekter å kjøre mot ${host} - ser ut som produksjon.`);
  }
}
