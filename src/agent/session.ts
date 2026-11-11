// All tilstand for én økt samlet ett sted - ingen modul-globale variabler. Det gjør verktøyene testbare
// (ny Session per test, injiser fetch) og hindrer at tilstand lekker mellom økter.
import { PvtKnowledge } from "../altinn/pvt-knowledge.js";
import { FALLBACK_SERVICE_OWNER_SCOPES, TestUserPool } from "../altinn/test-users.js";
import { TokenClient } from "../altinn/token-client.js";
import type { Config } from "../config.js";
import { Redactor } from "../policy/redact.js";
import { OwnedData, type OwnedDataSnapshot } from "../policy/requests.js";
import type { TestUserPoolSnapshot } from "../altinn/test-users.js";

/** Én HTTP-forespørsel. Loggen er fasiten i rapporten: krav og funn viser til kall-ID-er. Alt er renset. */
export type HttpLogEntry = {
  id: number;
  user: string;
  auth: string; // beskrivelse av tokenet (plassholder i curl), aldri selve tokenet
  api: string;
  method: string;
  path: string;
  url: string;
  requestHeaders: Record<string, string>; // inkl. plassholdere for hemmelige headere
  requestBody?: string;
  status: number | "feil";
  contentType?: string;
  responseExcerpt: string;
  why: string;
  ms: number;
};

export type Check = {
  criterion: string;
  coverage: string;
  source: string;
  result: "bestått" | "feilet" | "ikke testet";
  expected: string;
  actual: string;
  calls: number[];
};

export type Finding = {
  title: string;
  severity: "kritisk" | "høy" | "middels" | "lav";
  criterion: string;
  expected: string;
  actual: string;
  calls: number[];
  /** Nummeret på issuen i altinn-auth hvis feilen allerede er meldt. */
  knownIssue: number | null;
};

export class Session {
  readonly redactor: Redactor;
  readonly users: TestUserPool;
  readonly tokens: TokenClient;
  owned = new OwnedData();
  readonly httpLog: HttpLogEntry[] = [];
  /** Hele svaret per kall (maskert), så inspect_call kan hente mer uten nytt HTTP-kall. */
  readonly responseBodies = new Map<number, string>();
  readonly checks: Check[] = [];
  readonly findings: Finding[] = [];
  readonly fetch: typeof fetch;
  /** API-kunnskap og scopes fra altinn-platform-validation-tests (lest fra GitHub, ikke kopiert). */
  readonly knowledge: PvtKnowledge;
  /** Scopes tjenesteeier-tokens kan få. Fylles av init(); stabil gjennom økten (verktøyskjemaet bygges fra den). */
  allowedScopes: string[] = FALLBACK_SERVICE_OWNER_SCOPES;

  constructor(
    readonly config: Config,
    deps: { fetch?: typeof fetch; random?: () => number; githubToken?: string } = {},
  ) {
    this.fetch = deps.fetch ?? fetch;
    this.knowledge = new PvtKnowledge({ fetch: this.fetch, githubToken: deps.githubToken });
    this.redactor = new Redactor(config.secrets);
    this.users = new TestUserPool({
      env: config.env,
      testdataBaseUrl: config.testdataBaseUrl,
      redactor: this.redactor,
      fetch: this.fetch,
      random: deps.random,
    });
    this.tokens = new TokenClient({
      env: config.env,
      username: config.tokenGenerator.username,
      password: config.tokenGenerator.password,
      personalScopes: config.testUser.scopes,
      authLvl: config.testUser.authLvl,
      redactor: this.redactor,
      fetch: this.fetch,
    });
  }

  /** Henter scope-lista fra PVT. Feiler det, brukes en trygg reserve - økten skal ikke stoppe av det. */
  async init(): Promise<void> {
    try {
      const scopes = await this.knowledge.allowedScopes();
      if (scopes.length) this.allowedScopes = scopes;
    } catch {
      // behold FALLBACK_SERVICE_OWNER_SCOPES
    }
  }

  private callSeq = 0;

  /** Reserverer neste kall-ID. Trengs fordi samtidige kall (http_burst) logges i den rekkefølgen de blir ferdige. */
  nextCallId(): number {
    return ++this.callSeq;
  }

  hasCall(id: number): boolean {
    return this.httpLog.some((e) => e.id === id);
  }

  /**
   * Tilstanden som trengs for å fortsette økten etter en omstart av MCP-serveren. Loggen er allerede maskert.
   * Svarene (responseBodies) er ikke med - de er store og lagres én gang per kall av MCP-lageret.
   */
  snapshot(): SessionSnapshot {
    return {
      env: this.config.env,
      callSeq: this.callSeq,
      httpLog: this.httpLog,
      checks: this.checks,
      findings: this.findings,
      owned: this.owned.toJSON(),
      users: this.users.snapshot(),
    };
  }

  /** Fortsetter en lagret økt. Lagret tilstand fra et annet miljø avvises. */
  restore(snapshot: SessionSnapshot): void {
    if (snapshot.env !== this.config.env) {
      throw new Error(`Lagret økt er for ${snapshot.env}, ikke ${this.config.env}`);
    }
    this.callSeq = snapshot.callSeq;
    this.httpLog.push(...snapshot.httpLog);
    this.checks.push(...snapshot.checks);
    this.findings.push(...snapshot.findings);
    this.owned = OwnedData.from(snapshot.owned);
    this.users.restore(snapshot.users);
  }
}

export type SessionSnapshot = {
  env: string;
  callSeq: number;
  httpLog: HttpLogEntry[];
  checks: Check[];
  findings: Finding[];
  owned: OwnedDataSnapshot;
  users: TestUserPoolSnapshot;
};
