// Agenten skal kun kunne kjøres for Altinn/altinn-auth (og fra eierens eget repo, Nyeng/altinn-qa-agent).
// Dette er ett av flere lag (se README → "Låst til altinn-auth"): den egentlige sperren er at secrets bare
// finnes i de tillatte repoene, og at verter er hardkodet i environments.ts.
export const ALLOWED_REPOSITORIES = ["Altinn/altinn-auth", "Nyeng/altinn-qa-agent"];

export function assertAllowedRepository(env: NodeJS.ProcessEnv): void {
  if (env.GITHUB_ACTIONS !== "true") return; // lokal kjøring
  const repo = env.GITHUB_REPOSITORY ?? "";
  if (!ALLOWED_REPOSITORIES.includes(repo)) {
    throw new Error(`Son of Vegard er kun tillatt for ${ALLOWED_REPOSITORIES.join(", ")} (kjørte i "${repo}").`);
  }
}
