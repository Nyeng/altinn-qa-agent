// Fjerner hemmeligheter fra alt som går tilbake til modellen eller inn i rapporten. To lag:
//   1. Kjente verdier (tokens, nøkler, pid) - også i vanlige omkodinger (JSON-escapet, URL-kodet, base64)
//   2. Mønstre for ting som ser ut som tokens (JWT, Bearer/Basic) - fanger også hemmeligheter vi ikke kjenner,
//      f.eks. en annen brukers token som API-et lekker
// Markørene er bevisst tydelige: at et API-svar inneholder et token er i seg selv et funn (lekkasje), så modellen
// må kunne se AT det skjedde - uten å se verdien.
export const SECRET_MARKER = "[SON OF VEGARD: HEMMELIGHET FJERNET - API-ET RETURNERTE DENNE]";
export const TOKEN_MARKER = "[SON OF VEGARD: MULIG TOKEN FJERNET - API-ET RETURNERTE ET TOKEN]";

const MIN_SECRET_LENGTH = 6;

// JWT (også avkortet eller bare header-delen), og verdier etter Bearer/Basic.
const TOKEN_PATTERNS = [
  /\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*){0,2}/g,
  /\b(Bearer|Basic)\s+(?!\[SON OF VEGARD)[A-Za-z0-9._~+/=-]{8,}/gi,
];

export class Redactor {
  private readonly secrets = new Set<string>();

  constructor(initial: Iterable<string | undefined> = []) {
    for (const s of initial) this.add(s);
  }

  add(secret: string | undefined): void {
    if (!secret || secret.length < MIN_SECRET_LENGTH) return;
    for (const variant of encodings(secret)) this.secrets.add(variant);
  }

  redact(text: string): string {
    // Lengste først, så en hemmelighet som er en del av en annen ikke etterlater biter av den lange.
    const known = [...this.secrets].sort((a, b) => b.length - a.length);
    let out = text;
    for (const secret of known) out = out.replaceAll(secret, SECRET_MARKER);
    for (const pattern of TOKEN_PATTERNS) {
      out = out.replace(pattern, (match, scheme?: string) =>
        scheme && /^(bearer|basic)$/i.test(scheme) ? `${scheme} ${TOKEN_MARKER}` : TOKEN_MARKER,
      );
    }
    return out;
  }
}

// Formene en hemmelighet typisk dukker opp i når et API speiler den tilbake.
function encodings(secret: string): string[] {
  const variants = new Set([
    secret,
    JSON.stringify(secret).slice(1, -1), // JSON-escapet (\", \\, \u...)
    secret.replaceAll("/", "\\/"), // JSON med escapet skråstrek
    encodeURIComponent(secret), // URL-kodet
    Buffer.from(secret).toString("base64"), // base64
  ]);
  return [...variants].filter((v) => v.length >= MIN_SECRET_LENGTH);
}
