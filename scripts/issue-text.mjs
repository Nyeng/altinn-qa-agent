// Tittel og beskrivelse for forespørsels-issues. Issuen skal fortelle HVA som testes (PR- eller Feature-tittel og
// et kort sammendrag), ikke bare en id. Ren tekstbehandling - ingen kall, så den kan testes direkte.

const MAX_TITLE = 90;
const MAX_SUMMARY = 400;

/** "bug(resource-registry): Fix next link" → "Fix next link". "Feat (x): y" og "chore!: z" håndteres også. */
export function humanTitle(title) {
  const stripped = title.replace(/^\s*[a-z]+\s*(\([^)]*\))?!?\s*:\s*/i, "").trim();
  const text = stripped || title.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Første meningsfulle avsnitt i en PR- eller issue-tekst (hopper over overskrifter, sitater, maler og HTML). */
export function summary(body) {
  if (!body) return "";
  const cleaned = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => {
      const l = line.trim();
      return !(
        l.startsWith("#") ||
        l.startsWith(">") ||
        l.startsWith("|") ||
        l.startsWith("```") ||
        /^(🤖|resolves|fixes|closes|related)/i.test(l) ||
        /^\*\*(tl;dr|description|beskrivelse)\*\*:?$/i.test(l)
      );
    })
    .join("\n");
  // Lister beholdes som lister; vanlig tekst slås sammen til ett avsnitt.
  const paragraph = cleaned
    .split(/\n\s*\n/)
    .map((p) => {
      const lines = p
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      return lines.some((l) => /^[-*] /.test(l)) ? lines.join("\n") : lines.join(" ");
    })
    .find((p) => p.length > 20);
  if (!paragraph) return "";
  return paragraph.length > MAX_SUMMARY ? `${paragraph.slice(0, MAX_SUMMARY - 1)}…` : paragraph;
}

/** "🕵️ Fix next link to be included (altinn-auth#4613 · at22)" - id og miljø står til slutt, for sporing. */
export function issueTitle({ title, number, env, isFeature = false }) {
  const ref = `(altinn-auth#${number} · ${env})`;
  const prefix = isFeature ? "Feature: " : "";
  let text = `${prefix}${humanTitle(title)}`;
  if (text.length > MAX_TITLE) text = `${text.slice(0, MAX_TITLE - 1)}…`;
  return `🕵️ ${text} ${ref}`;
}

/** Kort beskrivelse øverst i issuen: hva endringen er, med lenke. */
export function issueIntro({ title, body, url, kind, extra }) {
  const lines = [`**${kind}:** [${humanTitle(title)}](${url})`];
  const text = summary(body);
  if (text) lines.push("", text);
  if (extra) lines.push("", extra);
  return lines.join("\n");
}
