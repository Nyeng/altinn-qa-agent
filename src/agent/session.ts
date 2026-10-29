// All tilstand for én økt samlet ett sted - ingen modul-globale variabler. Det gjør verktøyene testbare
// (ny Session per test, injiser fetch) og hindrer at tilstand lekker mellom økter.
import { PvtKnowledge } from "../altinn/pvt-knowledge.js";
import { FALLBACK_SERVICE_OWNER_SCOPES, TestUserPool } from "../altinn/test-users.js";
import { TokenClient } from "../altinn/token-client.js";
import type { Config } from "../config.js";
import { Redactor } from "../policy/redact.js";
import { OwnedData } from "../policy/requests.js";

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
};

export class Session {
  readonly redactor: Redactor;
  readonly users: TestUserPool;
  readonly tokens: TokenClient;
  readonly owned = new OwnedData();
  readonly httpLog: HttpLogEntry[] = [];
  /** Hele svaret per kall, så inspect_call kan hente mer uten nytt HTTP-kall. */
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

  hasCall(id: number): boolean {
    return this.httpLog.some((e) => e.id === id);
  }
}
