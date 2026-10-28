// Agenten skal kun kunne kjøres for Altinn/altinn-auth.
// Dette er ett av flere lag (se README → "Låst til altinn-auth"): den egentlige sperren er at
// secrets bare finnes i altinn-auth sitt GitHub Environment, og at verter er hardkodet i environments.ts.
export const ALLOWED_REPOSITORIES = ["Altinn/altinn-auth"];

export function assertAllowedRepository(): void {
  if (process.env.GITHUB_ACTIONS !== "true") return; // lokal kjøring
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  if (!ALLOWED_REPOSITORIES.includes(repo)) {
    throw new Error(`QA-agenten er kun tillatt for ${ALLOWED_REPOSITORIES.join(", ")} (kjørte i "${repo}").`);
  }
}
