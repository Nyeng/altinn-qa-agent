import type { Session } from "../agent/session.js";
import type { Tool } from "./define.js";
import { createHttpTools } from "./http.js";
import { resultTools } from "./results.js";
import { createUserTools } from "./users.js";

/** Alle verktøy agenten har i en økt. Rekkefølgen er stabil, så prompt-cachen treffer. */
export function createTools(session: Session): Tool[] {
  return [...createUserTools(session), ...createHttpTools(session.config), ...resultTools];
}
