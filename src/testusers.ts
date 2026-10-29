// Testbrukere Son of Vegard kan opptre som, hentet fra Altinn/altinn-platform-validation-tests og
// gruppert etter brukerflyt (se testdata-catalog.ts). Samme kilde som K6 sin fetchTestData.
// Son of Vegard ser alias, kategori, navn og ID-er - aldri fødselsnummer.
import { config } from "./config.js";
import { categoriesFor, type Category } from "./testdata-catalog.js";

const TESTDATA_BASE =
  process.env.QA_TESTDATA_BASE_URL ??
  "https://raw.githubusercontent.com/Altinn/altinn-platform-validation-tests/refs/heads/main";

export type TestUser = {
  alias: string;
  category: string;
  // Tjenesteeier: virksomhetstoken (GetEnterpriseToken) i stedet for sluttbrukertoken.
  enterprise?: { org: string; orgNo: string; scopes: string };
  pid?: string; // hemmelig - kun til tokenhenting
  userId?: string;
  partyId?: string;
  partyUuid?: string;
  context: Record<string, string>; // det Son of Vegard får se (kolonne → "verdi (forklaring)")
};

const rowsCache = new Map<string, Record<string, string>[]>();
const users: TestUser[] = [];
const usedRows = new Set<string>();

export function availableCategories(): Category[] {
  return categoriesFor(config.env);
}

export function knownUsers(): TestUser[] {
  return users;
}

// Egen testbruker fra miljøkonfigen (TEST_USER_*), hvis satt.
export function addConfiguredUser(): TestUser | undefined {
  const own = config.testUser;
  if (!own.pid && !(own.userId && own.partyUuid)) return undefined;
  return addUser({
    category: "egen (miljøkonfig)",
    pid: own.pid,
    userId: own.userId,
    partyId: own.partyId,
    partyUuid: own.partyUuid,
    context: {},
  });
}

// Plukker en ny, ubrukt testbruker fra en kategori.
export async function pickUser(categoryId: string): Promise<TestUser> {
  const category = availableCategories().find((c) => c.id === categoryId);
  if (!category) throw new Error(`Ukjent kategori "${categoryId}" for ${config.env}`);

  for (const source of category.sources.filter((s) => s.envs.includes(config.env))) {
    const path = source.path.replaceAll("{env}", config.env);
    const rows = await loadRows(path);
    rows.forEach((row, i) => (row.__key = `${path}#${i}`));
    // Tilfeldig rekkefølge, så ulike økter tester ulike brukere.
    for (const row of shuffle(rows)) {
      const pid = col(row, category.pid);
      if (!pid || usedRows.has(row.__key)) continue;
      usedRows.add(row.__key);
      const context: Record<string, string> = {};
      for (const [column, meaning] of Object.entries(category.context)) {
        if (row[column]) context[column] = `${row[column]} (${meaning})`;
      }
      return addUser({
        category: category.id,
        pid,
        userId: col(row, category.userId),
        partyId: col(row, category.partyId),
        partyUuid: col(row, category.partyUuid),
        context,
      });
    }
  }
  throw new Error(`Ingen flere ubrukte testbrukere i "${categoryId}" for ${config.env}`);
}

// Tjenesteeier-tokens, samme oppsett som K6 (resource-registry/create-resource-and-policy.js):
// TTD eier testressursene, og registeret sjekker at eierens orgnr matcher tokenet.
const SERVICE_OWNERS: Record<string, { org: string; orgNo: string }> = {
  ttd: { org: "ttd", orgNo: "991825827" },
};
export const SERVICE_OWNER_SCOPES = {
  "resource-read": "altinn:resourceregistry/resource.read",
  "resource-write": "altinn:resourceregistry/resource.write",
} as const;

export function addServiceOwner(owner: string, scopeKeys: (keyof typeof SERVICE_OWNER_SCOPES)[]): TestUser {
  const so = SERVICE_OWNERS[owner];
  if (!so) throw new Error(`Ukjent tjenesteeier "${owner}". Kjente: ${Object.keys(SERVICE_OWNERS).join(", ")}`);
  const scopes = scopeKeys.map((k) => SERVICE_OWNER_SCOPES[k]).join(" ");
  return addUser({
    category: `tjenesteeier ${so.org}`,
    enterprise: { ...so, scopes },
    context: { orgNo: `${so.orgNo} (tjenesteeierens orgnr)`, scopes: scopes },
  });
}

// Det Son of Vegard får se om en bruker.
export function describeUser(u: TestUser): string {
  const ids = [u.userId && `userId ${u.userId}`, u.partyId && `partyId ${u.partyId}`, u.partyUuid && `partyUuid ${u.partyUuid}`];
  const ctx = Object.entries(u.context).map(([k, v]) => `${k}: ${v}`);
  return `${u.alias} [${u.category}] ${[...ids, ...ctx].filter(Boolean).join("; ")}`;
}

function addUser(u: Omit<TestUser, "alias">): TestUser {
  const user = { ...u, alias: `bruker-${String.fromCharCode(65 + users.length)}` };
  users.push(user);
  return user;
}

// "a|b" = første kolonne som har verdi
function col(row: Record<string, string>, spec?: string): string | undefined {
  return spec?.split("|").map((c) => row[c]).find((v) => v);
}

async function loadRows(path: string): Promise<Record<string, string>[]> {
  const cached = rowsCache.get(path);
  if (cached) return cached;
  let rows: Record<string, string>[] = [];
  try {
    const res = await fetch(`${TESTDATA_BASE}/${path}`, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const [header, ...lines] = (await res.text()).trim().split(/\r?\n/);
      const cols = header.split(",").map((c) => c.trim().replaceAll('"', ""));
      rows = lines
        .filter((l) => l.trim())
        .map((line) => Object.fromEntries(line.split(",").map((v, i) => [cols[i], v.trim().replaceAll('"', "")])));
    }
  } catch {
    // datasettet er utilgjengelig - prøv neste kilde
  }
  rowsCache.set(path, rows);
  return rows;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
