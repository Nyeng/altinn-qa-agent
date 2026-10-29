// Testbrukere Son of Vegard kan opptre som, hentet fra Altinn/altinn-platform-validation-tests og gruppert etter
// brukerflyt (se testdata-catalog.ts). Samme kilde som K6 sin fetchTestData.
// Modellen ser alias, kategori, navn og ID-er - aldri fødselsnummer (pid registreres som hemmelighet).
import type { EnvName } from "../policy/environments.js";
import type { Redactor } from "../policy/redact.js";
import { categoriesFor, type Category } from "./testdata-catalog.js";

export type TestUser = {
  alias: string;
  category: string;
  /** Tjenesteeier: virksomhetstoken (GetEnterpriseToken) i stedet for sluttbrukertoken. */
  enterprise?: { org: string; orgNo: string; scopes: string };
  pid?: string; // hemmelig - kun til tokenhenting
  userId?: string;
  partyId?: string;
  partyUuid?: string;
  /** Det modellen får se (kolonne → "verdi (forklaring)"). */
  context: Record<string, string>;
};

// Tjenesteeiere, samme oppsett som K6 (resource-registry/create-resource-and-policy.js):
// TTD eier testressursene, og registeret sjekker at eierens orgnr matcher tokenet.
export const SERVICE_OWNERS: Record<string, { org: string; orgNo: string }> = {
  ttd: { org: "ttd", orgNo: "991825827" },
};
/** Brukes hvis scope-lista fra platform-validation-tests ikke kan hentes. */
export const FALLBACK_SERVICE_OWNER_SCOPES = [
  "altinn:resourceregistry/resource.read",
  "altinn:resourceregistry/resource.write",
];

type Row = Record<string, string>;

export class TestUserPool {
  private readonly users: TestUser[] = [];
  private readonly rowsCache = new Map<string, Row[]>();
  private readonly usedRows = new Set<string>();
  private activeUser: TestUser | undefined;

  constructor(
    private readonly opts: {
      env: EnvName;
      testdataBaseUrl: string;
      redactor: Redactor;
      fetch?: typeof fetch;
      random?: () => number;
    },
  ) {}

  categories(): Category[] {
    return categoriesFor(this.opts.env);
  }

  all(): TestUser[] {
    return this.users;
  }

  get active(): TestUser | undefined {
    return this.activeUser;
  }

  activate(alias: string): TestUser | undefined {
    const user = this.users.find((u) => u.alias === alias);
    if (user) this.activeUser = user;
    return user;
  }

  /** Legg til og aktiver en egen testbruker fra miljøkonfigen, hvis den er satt. */
  addConfigured(own: { pid?: string; userId?: string; partyId?: string; partyUuid?: string }): TestUser | undefined {
    if (!own.pid && !(own.userId && own.partyUuid)) return undefined;
    return this.add({ category: "egen (miljøkonfig)", ...own, context: {} });
  }

  /** Legg til og aktiver en tjenesteeier (virksomhetstoken). */
  addServiceOwner(owner: string, scopeList: string[]): TestUser {
    const so = SERVICE_OWNERS[owner];
    if (!so) throw new Error(`Ukjent tjenesteeier "${owner}". Kjente: ${Object.keys(SERVICE_OWNERS).join(", ")}`);
    const scopes = scopeList.join(" ");
    return this.add({
      category: `tjenesteeier ${so.org}`,
      enterprise: { ...so, scopes },
      context: { orgNo: `${so.orgNo} (tjenesteeierens orgnr)`, scopes },
    });
  }

  /** Hent og aktiver en ny, ubrukt testbruker fra en kategori. */
  async pick(categoryId: string): Promise<TestUser> {
    const category = this.categories().find((c) => c.id === categoryId);
    if (!category) throw new Error(`Ukjent kategori "${categoryId}" for ${this.opts.env}`);

    for (const source of category.sources.filter((s) => s.envs.includes(this.opts.env))) {
      const path = source.path.replaceAll("{env}", this.opts.env);
      const rows = (await this.loadRows(path)).map((row, i) => ({ row, key: `${path}#${i}` }));
      // Tilfeldig rekkefølge, så ulike økter tester ulike brukere.
      for (const { row, key } of this.shuffle(rows)) {
        const pid = col(row, category.pid);
        if (!pid || this.usedRows.has(key)) continue;
        this.usedRows.add(key);
        const context: Record<string, string> = {};
        for (const [column, meaning] of Object.entries(category.context)) {
          if (row[column]) context[column] = `${row[column]} (${meaning})`;
        }
        return this.add({
          category: category.id,
          pid,
          userId: col(row, category.userId),
          partyId: col(row, category.partyId),
          partyUuid: col(row, category.partyUuid),
          context,
        });
      }
    }
    throw new Error(`Ingen flere ubrukte testbrukere i "${categoryId}" for ${this.opts.env}`);
  }

  private add(u: Omit<TestUser, "alias">): TestUser {
    const user = { ...u, alias: `bruker-${String.fromCharCode(65 + this.users.length)}` };
    this.opts.redactor.add(user.pid);
    this.users.push(user);
    this.activeUser = user;
    return user;
  }

  private async loadRows(path: string): Promise<Row[]> {
    const cached = this.rowsCache.get(path);
    if (cached) return cached;
    let rows: Row[] = [];
    try {
      const res = await (this.opts.fetch ?? fetch)(`${this.opts.testdataBaseUrl}/${path}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) rows = parseCsv(await res.text());
    } catch {
      // datasettet er utilgjengelig - prøv neste kilde
    }
    this.rowsCache.set(path, rows);
    return rows;
  }

  private shuffle<T>(items: T[]): T[] {
    const random = this.opts.random ?? Math.random;
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

/** Det modellen får se om en bruker. */
export function describeUser(u: TestUser): string {
  const ids = [
    u.userId && `userId ${u.userId}`,
    u.partyId && `partyId ${u.partyId}`,
    u.partyUuid && `partyUuid ${u.partyUuid}`,
  ];
  const ctx = Object.entries(u.context).map(([k, v]) => `${k}: ${v}`);
  return `${u.alias} [${u.category}] ${[...ids, ...ctx].filter(Boolean).join("; ")}`;
}

// "a|b" = første kolonne som har verdi
function col(row: Row, spec?: string): string | undefined {
  return spec
    ?.split("|")
    .map((c) => row[c])
    .find((v) => v);
}

export function parseCsv(text: string): Row[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (!header) return [];
  const cols = header.split(",").map((c) => c.trim().replaceAll('"', ""));
  return lines
    .filter((l) => l.trim())
    .map((line) => Object.fromEntries(line.split(",").map((v, i) => [cols[i], v.trim().replaceAll('"', "")])));
}
