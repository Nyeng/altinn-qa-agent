# altinn-qa-agent

En utforskende tester og QA-agent for **Altinn Autorisasjon og Tilgangsstyring** ([Altinn/altinn-auth](https://github.com/Altinn/altinn-auth)),
bygget direkte på Claude API. Prosjektet er også studieprosjekt til **Claude Certified Developer – Foundations**.

Agenten tar et **charter** (session-based exploratory testing), utforsker API-ene innenfor en tidsboks,
fører notater og rapporterer funn, og skriver en markdown-rapport til `reports/`.

## Kom i gang lokalt

```bash
npm install
cp .env.example .env                       # ANTHROPIC_API_KEY + felles token generator-bruker
cp configs/example.json configs/at23.json  # én per miljø: testbruker og subscription keys
npm run explore -- --env=at23 charters/01-autoriserte-parter-og-delegering.md
```

## Miljøer og API-er

| Miljø | `platform` | `am-bff` |
|---|---|---|
| `at22` | `https://platform.at22.altinn.cloud` | `https://am.ui.at22.altinn.cloud/accessmanagement/api/v1` |
| `at23` | `https://platform.at23.altinn.cloud` | `https://am.ui.at23.altinn.cloud/accessmanagement/api/v1` |
| `tt02` | `https://platform.tt02.altinn.no` | `https://am.ui.tt02.altinn.no/accessmanagement/api/v1` |

Samme URL-mønster som `altinn-platform-validation-tests` og `altinn-access-management-frontend`.
Token hentes fra Altinn test token generator (`GetPersonalToken`) for testbrukeren i miljøets konfig.

### Konfig per miljø

Alt miljøspesifikt ligger i **én JSON per miljø** (se [`configs/example.json`](configs/example.json)):
`testUser` (pid og ev. userId/partyId/partyUuid), `apiHeaders` (hemmelige headere per API, f.eks.
`Ocp-Apim-Subscription-Key`) og ev. ekstra `apis`.

| Hvor | Felles | Per miljø |
|---|---|---|
| Lokalt | `.env` | `configs/at22.json`, `configs/at23.json`, `configs/tt02.json` (gitignored) |
| GitHub Actions | secrets `ANTHROPIC_API_KEY`, `TOKEN_GENERATOR_USERNAME`, `TOKEN_GENERATOR_PASSWORD` | secrets `QA_CONFIG_AT22`, `QA_CONFIG_AT23`, `QA_CONFIG_TT02` |

## Start fra GitHub: `/snoken` (kun i altinn-auth)

Kommenter på en issue eller PR i Altinn/altinn-auth:

```
/snoken at23 Utforsk delegering av tilgangspakker til en annen person
```

Workflowen reagerer med 👀, kjører økten og svarer med rapporten. Miljø er `at23` (standard), `at22` eller `tt02`;
resten av kommentaren er charteret. På en PR legges diffen ved.
Workflowen ligger i [`templates/altinn-auth/snoken.yml`](templates/altinn-auth/snoken.yml) og kopieres til altinn-auth.

## Låst til altinn-auth

Agenten skal ikke kunne brukes i andre repoer eller mot andre systemer. Flere lag:

1. **Secrets finnes bare i altinn-auth**, i GitHub Environment `qa-agent` (kun `main`, ev. påkrevde godkjennere).
   Uten dem kan agenten ikke hente token eller kalle Claude.
2. **Workflowen** kjører kun når `github.repository == 'Altinn/altinn-auth'` og kommentaren er fra et org-medlem.
3. **Koden** nekter å starte i GitHub Actions utenfor `Altinn/altinn-auth` ([`src/guard.ts`](src/guard.ts)).
4. **Verter er hardkodet** til Altinns testmiljøer (`*.at22.altinn.cloud`, `*.at23.altinn.cloud`, `*.tt02.altinn.no`, kun https).
   Ingen konfig kan rette agenten mot prod eller andre nettsteder ([`src/environments.ts`](src/environments.ts)).
5. **Agent-repoet er privat**; altinn-auth henter det med en lesetoken (`QA_AGENT_REPO_TOKEN`).

## Sikkerhet ellers

- Secrets (token, subscription keys, token generator-passord, PID) legges på av verktøyet og vaskes ut av svar.
  **Claude ser dem aldri.** I Actions maskeres hvert hemmelige felt i loggen.
- `DELETE` er av som standard (`allowDelete: false`).
- Innhold i API-svar og PR-differ behandles som data, ikke instruksjoner (prompt injection).
- Maks antall verktøykall per økt (`maxSteps`).

## Struktur

| Fil | Hva |
|---|---|
| `src/agent.ts` | Manuell agentløkke: `stop_reason`, `tool_use` → `tool_result`, caching, fallback |
| `src/env-config.ts` | Leser og validerer miljøets JSON-konfig, maskerer secrets i Actions |
| `src/environments.ts` | Miljøer, innebygde API-er og hardkodet vert-allowlist |
| `src/guard.ts` | Repo-lås (kun Altinn/altinn-auth i Actions) |
| `src/auth.ts` | Sluttbrukertoken via Altinn test token generator |
| `src/tools/http.ts` | `http_request` mot navngitte API-er, med auth-injeksjon og redaksjon |
| `src/tools/session.ts` | `record_note` / `report_finding` med `strict: true`-skjema |
| `src/prompts.ts` | Systemprompt: tester-persona og heuristikker for tilgangsstyring |
| `src/report.ts` | Øktrapport (SBTM-format) |
| `charters/` | Testcharter, ett per økt |
| `templates/altinn-auth/` | Workflow som kopieres til altinn-auth |

## Veikart (= studieplan for eksamen)

- [x] **Uke 1 – API-grunnmur:** Messages API, manuell tool-løkke, HTTP-verktøy, rapport, miljøer, GitHub-trigger
- [ ] **Uke 2 – Tool use + strukturert output:** Playwright-verktøy mot tilgangsstyring-UI (TestID-innlogging som i
      platform-validation-tests), handlinger via tilgjengelighetstreet (`getByRole`) i stedet for selektorer
- [ ] **Uke 3 – Agenter/MCP:** orkestrator som lager charter fra `git diff`, utforsker-subagenter, verifikator-agent som reproduserer funn
- [ ] **Uke 4 – Evals + sikkerhet:** plantede feil → mål funnrate og falske positiver; prompt injection-tester; k6-verktøy for enkel last
- [ ] **Uke 5 – Prøveeksamener**, svake domener
- [ ] **Uke 6 – Repetisjon og eksamen** (Pearson-testsenter, Glasspaper)
