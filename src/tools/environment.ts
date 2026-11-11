// Verktøy for miljøfila (environments/<miljø>.json): faste testbrukere og oppslag i ressurser og flagg.
// Ingenting her er hemmelig - fødselsnummer maskeres som for alle brukere.
import { z } from "zod";
import type { Session } from "../agent/session.js";
import { describeUser } from "../altinn/test-users.js";
import { defineTool, type Tool } from "./define.js";

export function createEnvironmentTools(session: Session): Tool[] {
  const environment = session.config.environment;
  const names = Object.keys(environment.testUsers);
  const tools: Tool[] = [];

  if (names.length) {
    tools.push(
      defineTool({
        name: "use_test_user",
        description:
          "Bruk en fast testbruker fra miljøfila og gjør den til aktiv bruker. Faste brukere har kjente relasjoner " +
          "(se env_info), så tester kan gjentas og rapporter peker på de samme brukerne. Bruk pick_test_user når du " +
          "trenger en tilfeldig bruker fra en kategori.\n" +
          names.map((n) => `- ${n}: ${environment.testUsers[n].description}`).join("\n"),
        strict: true,
        input: z.strictObject({ name: z.enum(names as [string, ...string[]]) }),
        label: (i) => `👤 fast bruker ${i.name}`,
        run: ({ name }, s) => ({
          content: `Aktiv bruker er nå ${describeUser(s.users.useFixed(name, s.config.environment.testUsers[name]))}`,
        }),
      }),
    );
  }

  tools.push(
    defineTool({
      name: "env_info",
      countsAsStep: false,
      description:
        "Slå opp det som er kjent om miljøet fra miljøfila: faste testbrukere og virksomhetene deres, faste " +
        "testressurser med RightKeys per action, og flaggstatus med dato for når den sist ble bekreftet. Sjekk " +
        "flaggene her før du konkluderer med at en feature ikke virker.",
      input: z.strictObject({}),
      label: () => "🗺️ env_info",
      run: (_, s) => ({ content: describeEnvironment(s) }),
    }),
  );
  return tools;
}

function describeEnvironment(s: Session): string {
  const e = s.config.environment;
  const users = Object.entries(e.testUsers).map(([name, u]) => {
    const org = u.org
      ? ` · virksomhet ${u.org.name ? `${u.org.name} ` : ""}${u.org.orgNo}${u.org.partyUuid ? ` (${u.org.partyUuid})` : ""}${u.org.role ? `, ${u.org.role}` : ""}`
      : "";
    return `- ${name}: ${u.description}${u.partyUuid ? ` · partyUuid ${u.partyUuid}` : ""}${org}`;
  });
  const resources = Object.entries(e.resources).map(([id, r]) => {
    const keys = Object.entries(r.rightKeys ?? {}).map(([action, key]) => `    ${action}: ${key}`);
    return [`- ${id}${r.description ? `: ${r.description}` : ""}`, ...keys].join("\n");
  });
  const flags = Object.entries(e.flags).map(
    ([name, f]) => `- ${name}: ${f.on ? "på" : "av"} (bekreftet ${f.checked}${f.how ? `, ${f.how}` : ""})`,
  );
  return [
    `Miljø: ${s.config.env}`,
    `Faste testbrukere (bruk med use_test_user):\n${users.join("\n") || "- ingen"}`,
    ...(e.serviceOwner ? [`Tjenesteeier: ${e.serviceOwner.org} (${e.serviceOwner.orgNo})`] : []),
    `Testressurser:\n${resources.join("\n") || "- ingen"}`,
    `Flagg (status kan ha endret seg siden datoen):\n${flags.join("\n") || "- ingen registrert"}`,
  ].join("\n\n");
}
