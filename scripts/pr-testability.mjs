// Klassifiserer en PR i altinn-auth etter hvor testbar den er for Son of Vegard (API-tester i testmiljø).
// Brukes av pollingen (hopper over det som ikke kan testes) og charteret (styrer hva Son of Vegard skal gjøre).
// Regler bygd fra de siste 80 mergede PR-ene i repoet.

const APP_DIRS = {
  "Altinn.AccessManagement": "access-management",
  "Altinn.Authorization": "authorization",
  "Altinn.ResourceRegistry": "resource-registry",
  "Altinn.Register": "register",
  "Altinn.Authentication": "authentication",
};

// Kodefiler som kan endre oppførselen til en kjørende tjeneste.
// Testbiblioteker (f.eks. src/libs/Altinn.Authorization.Testing) teller ikke.
const isRuntimeCode = (p) =>
  (/^src\/apps\/[^/]+\/src\//.test(p) || /^src\/libs\/[^/]+\/src\//.test(p) || /^src\/pkgs\/[^/]+\/src\//.test(p)) &&
  !/^src\/libs\/[^/]*Testing[^/]*\//.test(p);
const isDeployInfra = (p) =>
  /^src\/apps\/[^/]+\/(manifests|infra|containers|syncroot)\//.test(p) ||
  /docker-bake\.hcl$/.test(p) ||
  /^containers\//.test(p);
// Infrastruktur der feature-flagg (og annen plattformkonfig) defineres.
const isPlatformInfra = (p) => /^infra\/(deploy|modules)\//.test(p);
const isTestOnly = (p) => /^src\/(apps|libs|tools|pkgs)\/[^/]+\/test\//.test(p) || /^eng\/testing\//.test(p);
const isRepoTooling = (p) =>
  /^\.github\//.test(p) ||
  /^\.(agents|claude)\//.test(p) ||
  /^docs\//.test(p) ||
  /(^|\/)(AGENTS|CONTRIBUTING|README)\.md$/.test(p) ||
  /(^|\/)\.editorconfig$|\.coderabbit\.yaml$|renovate\.json$|cliff\.toml$|release-please|\.gitignore$|\.git-blame/.test(p) ||
  /\.slnx?$|Directory\.Build\.|\.ruleset$|devenv\.|global\.json$|docker-compose\.yml$/.test(p);

export const CATEGORIES = {
  funksjonell: {
    icon: "🟢",
    name: "Funksjonell endring",
    run: true,
    guidance: "Verifiser akseptansekriteriene direkte mot API-et som endres.",
  },
  "bak-flagg": {
    icon: "🟡",
    name: "Bak feature-flagg",
    run: true,
    guidance:
      "Endringen ligger bak et feature-flagg. Finn flaggnavnet i diffen og sjekk om oppførselen er aktiv i miljøet. " +
      "Er den ikke aktiv, registrer kravene som 'ikke testet' med begrunnelse - det er ikke et funn. Få kall.",
  },
  regresjon: {
    icon: "🟠",
    name: "Teknisk endring i kode",
    run: true,
    guidance:
      "Ingen ny oppførsel forventes. Gjør en kort regresjonstest: kall de endepunktene diffen berører og bekreft at " +
      "de svarer som før (statuskoder, format). Maks 3-4 kall.",
  },
  deploy: {
    icon: "🔵",
    name: "Deploy/infrastruktur",
    run: true,
    guidance:
      "Bekreft bare at de berørte tjenestene kjører og svarer i miljøet etter deploy (ett lese-kall per app). " +
      "Ikke test funksjonalitet.",
  },
  "ikke-testbar": { icon: "⚪", name: "Ikke testbar for Son of Vegard", run: false, guidance: "" },
};

/**
 * @param {{ title: string, files: string[] }} pr
 * @returns {{ category: keyof typeof CATEGORIES, apps: string[], reason: string, guidance: string }}
 */
export function classify({ title, files }) {
  const type = (title.match(/^(\w+)(\(|!|:)/)?.[1] ?? "").toLowerCase(); // feat, fix, bug, chore, ci, test, docs ...
  const apps = [...new Set(files.map((f) => f.match(/^src\/apps\/([^/]+)\//)?.[1]).map((d) => APP_DIRS[d]).filter(Boolean))];
  const code = files.filter(isRuntimeCode);
  const infra = files.filter(isDeployInfra);
  // Flagg: PR-en sier selv at den handler om feature-flagg/toggle, og endrer infrastruktur der flagg ligger.
  const flagChange =
    /feature.?(flag|toggle)|\btoggle\b/i.test(title) &&
    files.some((f) => isPlatformInfra(f) || /^src\/apps\/[^/]+\/infra\//.test(f));
  const toolingType = ["ci", "build", "docs", "test", "style"].includes(type);
  const behaviourChange = ["feat", "fix", "bug", "perf"].includes(type) || /\bfix|feat|bug\b/i.test(title);

  if (code.length && flagChange) {
    return {
      category: "bak-flagg",
      apps,
      reason: "Endrer kode og feature-flagg i samme PR.",
      guidance: CATEGORIES["bak-flagg"].guidance,
    };
  }
  if (code.length && behaviourChange) {
    return {
      category: "funksjonell",
      apps,
      reason: `Endrer kjørende kode (${code.length} filer) med ny/rettet oppførsel.`,
      guidance: CATEGORIES.funksjonell.guidance,
    };
  }
  if (code.length) {
    return {
      category: "regresjon",
      apps,
      reason: `Teknisk endring i kjørende kode (${type || "chore"}) uten ny oppførsel.`,
      guidance: CATEGORIES.regresjon.guidance,
    };
  }
  if (flagChange && !toolingType) {
    return {
      category: "bak-flagg",
      apps,
      reason: "Endrer bare feature-flagg.",
      guidance: CATEGORIES["bak-flagg"].guidance,
    };
  }
  if (infra.length || files.some(isPlatformInfra)) {
    return {
      category: "deploy",
      apps,
      reason: "Endrer manifester, containere eller infrastruktur - ikke API-oppførsel.",
      guidance: CATEGORIES.deploy.guidance,
    };
  }
  const tooling = files.every((f) => isRepoTooling(f) || isTestOnly(f));
  return {
    category: "ikke-testbar",
    apps,
    reason: tooling
      ? files.some(isTestOnly)
        ? "Endrer bare tester, CI eller dokumentasjon."
        : "Endrer bare CI, verktøy, konfig eller dokumentasjon."
      : "Ingen endring i kjørende kode eller deploy.",
    guidance: "",
  };
}
