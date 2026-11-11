// Gjør PR-konteksten i charteret mindre. Charteret ligger i konteksten i HVERT steg av agenten, så hver token
// her betales mange ganger (en måling i november 2026: ca. 10k av ca. 40k tokens per steg var charteret).
// Rene funksjoner, testet i test/charter.test.ts.

/** Filer som ikke sier noe om hvilken oppførsel som er endret: tester, migreringer, generert kode, dokumentasjon. */
const NOISE = [
  /(^|\/)test(s)?\//i,
  /\.Tests?\//,
  /Tests?\.cs$/,
  /\/Migrations\//,
  /\.Designer\.cs$/,
  /ModelSnapshot\.cs$/,
  /\.(md|bru|snap|lock|svg|png)$/i,
  /package-lock\.json$/,
];

export const isNoise = (path) => NOISE.some((re) => re.test(path));

/**
 * Hvor mye en fil sier om testbar oppførsel. Lavest først: kontrakter (DTO-er, feilkoder) og controllere viser
 * hva API-et tar imot og svarer, deretter tjenester og hjelpere, og til slutt resten.
 */
function priority(path) {
  if (/Contracts\/|Dto\.cs$|ValidationErrors|Problems?\.cs$|Errors?\.cs$/.test(path)) return 0;
  if (/Controller(Base)?\.cs$/.test(path)) return 1;
  if (/(Service|Helper|Approval|Validator|Mapper)\.cs$|\/Utils\//.test(path)) return 2;
  return 3;
}

/** Linjer som tar plass uten å si noe om oppførselen: using, attributter, dokumentasjonskommentarer, tomme linjer. */
const LOW_VALUE_LINE = /^[+-]\s*(using [\w.]+;|\[[A-Z][\w<>]*(\(.*\))?\]|\/\/\/.*|)$/;

const basename = (path) => path.split("/").pop();

/**
 * Diffen uten kontekstlinjer, og bare for filer som endrer oppførsel, de viktigste først. Hver fil får en
 * overskrift og bare @@-linjer og +/- linjer (uten using, attributter og dokumentasjonskommentarer), med tak per
 * fil og totalt. Filer som utelates, listes med navn og antall linjer.
 */
export function compactDiff(diff, { maxChars = 9000, maxPerFile = 2500 } = {}) {
  const files = diff
    .split(/^diff --git /m)
    .slice(1)
    .map((file) => {
      const path = file.match(/^a\/(\S+)/)?.[1] ?? file.split("\n")[0];
      const lines = file.split("\n").filter((l) => /^(@@|[+-])/.test(l) && !/^(\+\+\+|---) /.test(l));
      const counts = `+${lines.filter((l) => l[0] === "+").length}/-${lines.filter((l) => l[0] === "-").length}`;
      const changed = lines
        .filter((l) => !LOW_VALUE_LINE.test(l))
        .map((l) => (l.startsWith("@@") ? l.replace(/^(@@[^@]*@@).*$/, "$1") : l))
        // @@-linjer uten endringer etter seg (alt var using/attributter) er bare støy
        .filter((l, i, all) => !l.startsWith("@@") || (all[i + 1] && !all[i + 1].startsWith("@@")));
      return { path, counts, changed };
    })
    .sort((a, b) => priority(a.path) - priority(b.path));

  const kept = [];
  const skipped = [];
  let used = 0;
  for (const { path, counts, changed } of files) {
    if (isNoise(path) || used >= maxChars || changed.length === 0) {
      skipped.push(`${basename(path)} (${counts})`);
      continue;
    }
    let text = `### ${path}\n${changed.join("\n")}`;
    if (text.length > maxPerFile) text = `${text.slice(0, maxPerFile)}\n… [resten av filen utelatt]`;
    if (used + text.length > maxChars) text = `${text.slice(0, Math.max(0, maxChars - used))}\n… [avkortet]`;
    used += text.length;
    kept.push(text);
  }
  return [
    ...kept,
    skipped.length ? `Utelatt (tester, migreringer, generert kode eller over taket): ${skipped.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Seksjoner som beskriver hvordan PR-en ble laget eller hvordan GUI-et skal se ut - ikke hvilken API-oppførsel som
 * skal testes. Hele seksjonen fjernes, med underseksjoner.
 */
const NOISE_SECTIONS =
  /^(ai assistance|verified|verification|testing|how (it was|we) tested|checklist|screenshots?|skjermbilder|forslag til brukerflyt|brukerflyt|design|skisser?)\b/i;

/**
 * Fjerner HTML-kommentarer, <details>-blokker og støyseksjoner (## AI assistance, ## Verified osv.) fra en
 * PR- eller issuetekst, og avkorter.
 */
export function cleanText(text, maxChars) {
  let out = (text ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<details>[\s\S]*?<\/details>/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // Del på overskrifter. En støyseksjon fjernes sammen med alle dypere overskrifter under seg.
  let skipBelow = 0;
  out = out
    .split(/^(?=#{1,6} )/m)
    .filter((part) => {
      const level = part.match(/^(#{1,6}) /)?.[1].length ?? 0;
      if (skipBelow && level > skipBelow) return false;
      skipBelow = 0;
      if (level && NOISE_SECTIONS.test(part.slice(level + 1).trim())) {
        skipBelow = level;
        return false;
      }
      return true;
    })
    .join("");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n… [avkortet]` : out;
}

// Forslag til api_reference-oppslag ut fra hvilke apper og klasser PR-en endrer, f.eks.
// src/apps/Altinn.AccessManagement/.../RequestService.cs → "access-management request".
const APP_AREAS = {
  "Altinn.AccessManagement": "access-management",
  "Altinn.Authorization": "authorization",
  "Altinn.Authentication": "authentication",
  "Altinn.ResourceRegistry": "resource-registry",
  "Altinn.Register": "register",
};
const GENERIC_WORDS = new Set([
  "service",
  "app",
  "access",
  "mgmt",
  "altinn",
  "base",
  "default",
  "core",
  "feature",
  "context",
  "model",
  "dto",
  "mapper",
  "options",
  "settings",
]);

export function apiReferenceHints(paths, max = 2) {
  const hints = new Set();
  for (const p of paths) {
    const app = p.match(/^src\/apps\/([^/]+)\/src\//)?.[1];
    if (!app || !APP_AREAS[app] || !p.endsWith(".cs") || isNoise(p)) continue;
    const name = p
      .split("/")
      .pop()
      .replace(/\.cs$/, "")
      .replace(/^I(?=[A-Z])/, "") // grensesnitt: IRequestService → RequestService
      .replace(/(Service|Controller|Repository|Query|Queries|Helper|Extensions|Constants)$/, "");
    const word = name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[\s_]+/)
      .find((w) => w.length > 2 && /^[a-z]+$/.test(w) && !GENERIC_WORDS.has(w));
    if (word) hints.add(`${APP_AREAS[app]} ${word}`);
  }
  return [...hints].slice(0, max);
}
