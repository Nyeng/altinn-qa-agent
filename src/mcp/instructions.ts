import type { Category } from "../altinn/testdata-catalog.js";
import type { Config } from "../config.js";

// Instruksjoner til den som bruker MCP-serveren (Claude Code). Kortere enn systemprompten til agenten:
// her er det et menneske som styrer, så stegbudsjett og arbeidsmåte for charter hører ikke hjemme.
// Stabil for en gitt konfig (ingen tidsstempler).
export function mcpInstructions(config: Config, categories: Category[]): string {
  return `Verktøyene til Son of Vegard mot Altinns testmiljø ${config.env}. API-er: ${Object.keys(config.apis).join(", ")}.
Kun testmiljøet - verten er låst i koden, og ingenting når prod.

Slik brukes de:
- Velg bruker først: pick_test_user (sluttbruker etter brukerflyt), switch_user, eller use_service_owner (TTD).
  Token og API-nøkler legges på automatisk og vises aldri. Ikke send Authorization selv.
- http_request gjør ett kall som aktiv bruker. Hvert svar starter med "Kall #N". Bruk "fields" når du vet
  hva du ser etter, og inspect_call for mer fra et svar du allerede har, i stedet for å kalle på nytt.
- http_burst sender samme kall 2-10 ganger samtidig (race conditions, idempotens).
- api_reference slår opp endepunkter og token-type i K6-klientene. known_issues søker i altinn-auth.
- record_check og report_finding registrerer krav og funn med kall-ID-ene som bevis.

Regler som håndheves i koden:
- PUT/PATCH bare mot data opprettet med POST i denne serverøkten. DELETE i tillegg mot egne snoken-*-ressurser.
  Delte testdata skal bare leses. Starter serveren på nytt, glemmes hva den har opprettet.
- Endepunkter som sender varsler eller e-post til ekte mottakere er sperret.

Maskering i svarene:
- "[SON OF VEGARD: HEMMELIGHET ...]" eller "[SON OF VEGARD: MULIG TOKEN ...]": API-et returnerte en nøkkel eller
  noe som ser ut som et token. Det er en lekkasje og et funn.
- "[SON OF VEGARD: FØDSELSNUMMER TIL bruker-X]" er testbrukerens fødselsnummer, maskert av serveren.

Testbrukere (syntetiske), gruppert etter brukerflyt:
${categories.map((c) => `- ${c.id}: ${c.flow}`).join("\n")}`;
}
