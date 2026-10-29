// Fjerner hemmeligheter fra alt som går tilbake til modellen eller inn i rapporten.
// Markøren er bevisst tydelig: at et API-svar inneholder tokenet eller en nøkkel er i seg selv et funn
// (lekkasje), så modellen må kunne se AT det skjedde - uten å se verdien.
export const SECRET_MARKER = "[SON OF VEGARD: HEMMELIGHET FJERNET - API-ET RETURNERTE DENNE]";

const MIN_SECRET_LENGTH = 6;

export class Redactor {
  private readonly secrets = new Set<string>();

  constructor(initial: Iterable<string | undefined> = []) {
    for (const s of initial) this.add(s);
  }

  add(secret: string | undefined): void {
    if (secret && secret.length >= MIN_SECRET_LENGTH) this.secrets.add(secret);
  }

  redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) out = out.replaceAll(secret, SECRET_MARKER);
    return out;
  }
}
