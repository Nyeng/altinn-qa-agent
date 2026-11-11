// Lagrer MCP-økten på disk, så en omstart av serveren (ny Claude Code-økt) ikke glemmer kall-loggen, brukerne,
// krav, funn og hva økten selv har opprettet (OwnedData, som PUT/PATCH/DELETE-sperren bygger på).
//
//   reports/mcp/<miljø>/state.json        alt unntatt svarene (skrives på nytt etter hvert verktøykall)
//   reports/mcp/<miljø>/bodies/<id>.txt   hele svaret per kall, maskert (skrives én gang)
//
// reports/ er gitignorert. Alt som lagres er allerede maskert av Session - aldri tokens eller nøkler.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Session, SessionSnapshot } from "../agent/session.js";

const MAX_LOADED_BODIES = 300;

export class SessionStore {
  private readonly written = new Set<number>();

  constructor(readonly dir: string) {}

  static forEnv(env: string, root = "reports/mcp"): SessionStore {
    return new SessionStore(path.join(root, env));
  }

  private get statePath(): string {
    return path.join(this.dir, "state.json");
  }

  private get bodiesDir(): string {
    return path.join(this.dir, "bodies");
  }

  /** Fortsetter lagret økt hvis den finnes. Returnerer true hvis noe ble lastet. */
  load(session: Session): boolean {
    if (!existsSync(this.statePath)) return false;
    const snapshot = JSON.parse(readFileSync(this.statePath, "utf8")) as SessionSnapshot;
    session.restore(snapshot);
    if (existsSync(this.bodiesDir)) {
      const ids = readdirSync(this.bodiesDir)
        .map((f) => Number.parseInt(f, 10))
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
        .slice(-MAX_LOADED_BODIES);
      for (const id of ids) {
        session.responseBodies.set(id, readFileSync(path.join(this.bodiesDir, `${id}.txt`), "utf8"));
        this.written.add(id);
      }
    }
    return true;
  }

  /** Skriver tilstanden og nye svar. Atomisk for state.json, så en avbrutt skriving ikke ødelegger økten. */
  save(session: Session): void {
    mkdirSync(this.bodiesDir, { recursive: true });
    for (const [id, text] of session.responseBodies) {
      if (this.written.has(id)) continue;
      writeFileSync(path.join(this.bodiesDir, `${id}.txt`), text);
      this.written.add(id);
    }
    const tmp = `${this.statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(session.snapshot(), null, 1));
    renameSync(tmp, this.statePath);
  }

  /** Flytter den lagrede økten til arkiv/<tidspunkt>, så neste økt starter blankt. Returnerer arkivmappa. */
  archive(now = new Date()): string | undefined {
    if (!existsSync(this.statePath)) return undefined;
    const target = path.join(this.dir, "arkiv", now.toISOString().replace(/[:.]/g, "-"));
    mkdirSync(target, { recursive: true });
    renameSync(this.statePath, path.join(target, "state.json"));
    if (existsSync(this.bodiesDir)) renameSync(this.bodiesDir, path.join(target, "bodies"));
    this.written.clear();
    return target;
  }
}
