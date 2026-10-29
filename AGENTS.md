# AGENTS.md

Veiledning for AI-agenter (og mennesker) som endrer dette repoet. Les dette før du endrer kode.

## Hva dette er

Son of Vegard: en test-agent som verifiserer nye features og rettinger i Altinn/altinn-auth mot API-ene i
testmiljøene (at22/at23/tt02), med Claude API. Agentløkka er bevisst skrevet for hånd (ikke SDK-ens tool runner) -
det er også et studieprosjekt for Claude Certified Developer – Foundations.

## Arkitektur

```
src/
  explore.ts            CLI: les charter → kjør agenten → skriv rapport
  config.ts             loadConfig(): all konfig, eksplisitt (ingen sideeffekter ved import)
  agent/
    loop.ts             runAgent(): stop_reason, tool_use → tool_result, caching, grenser. Klienten injiseres.
    session.ts          Session: ALL tilstand for én økt (brukere, tokens, logg, krav, funn)
    prompt.ts           systemPrompt(config, kategorier) - stabil, så den caches
    pricing.ts          estimert pris
  tools/
    define.ts           defineTool + register: zod-skjema → JSON-skjema, sentral validering og feilhåndtering
    http.ts             http_request, inspect_call
    users.ts            pick_test_user, switch_user, use_service_owner
    reference.ts        api_reference: API-kunnskap fra altinn-platform-validation-tests
    results.ts          record_check, report_finding
    fields.ts           utvalg fra JSON-svar
  policy/               sikkerhetsregler - rene funksjoner, testet
    environments.ts     miljøer og hardkodet vert-allowlist
    requests.ts         DELETE-/PUT-/PATCH-regler og OwnedData
    redact.ts           fjerning av hemmeligheter (synlig markør)
    guard.ts            repo-lås
  altinn/               testbrukere (katalog etter brukerflyt), token generator, og pvt-knowledge.ts:
                        K6-klienter og scopes fra platform-validation-tests, lest fra GitHub (ingen kopi)
  report/render.ts      kort rapport: Verifisert + Funn
scripts/                polling, charter og publisering i GitHub Actions (ren node, ingen avhengigheter)
test/                   node:test via tsx
```

## Regler som ikke skal brytes

- **Sikkerhet håndheves i kode, aldri bare i prompten.** Nye regler går i `src/policy/` med tester.
- **Hemmeligheter når aldri modellen.** Alt som returneres fra et verktøy går gjennom `session.redactor`.
- **Kun testmiljøer.** Vert-allowlisten i `policy/environments.ts` skal ikke utvides til prod.
- **PUT/PATCH kun mot data opprettet i økten, DELETE kun for egne `snoken-*`-ressurser.**
- **Ingenting som når ekte mottakere** (varselbestillinger, videresending på e-post) - sperret i `policy/requests.ts`.
- **Ikke kopier kunnskap fra platform-validation-tests.** Les den fra GitHub (`altinn/pvt-knowledge.ts`), så den
  aldri driver fra kilden. Tjenesteeier-scopes begrenses til PVT-lista minus admin, deploy og varselutsending.
- **Rapporten bygges fra HTTP-loggen**, ikke fra modellens tekst. Den skal være kort: Verifisert + Funn.
- **Ingen modul-global tilstand.** Tilstand hører hjemme i `Session`; `fetch` og API-klienten injiseres.
- **Systemprompt og verktøyliste skal være stabile** for en gitt konfig (ingen tidsstempler) - ellers brytes cachen.

## Konvensjoner

- Nye verktøy: `defineTool` i `src/tools/`, legg til i `tools/index.ts`, og skriv tester i `test/`.
- Kommentarer, feilmeldinger og tekst til modellen er på norsk.
- Ikke Bruno (brukes ikke av denne agenten). Regresjon og deploy dekkes av teamets eksisterende tester.

## Kommandoer

```bash
npm run check     # typesjekk + tester + formatering (kjøres også i CI)
npm run format    # formater med Prettier
npm run explore -- --env=at22 charters/<fil>.md
```
