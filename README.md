# altinn-qa-agent

En utforskende tester og QA-agent for Altinn 3-apper, bygget direkte på Claude API.
Prosjektet er også studieprosjekt til **Claude Certified Developer – Foundations**.

Agenten tar et **charter** (session-based exploratory testing), utforsker appens API innenfor en
tidsboks, fører notater og rapporterer funn, og skriver en markdown-rapport til `reports/`.

## Kom i gang

```bash
npm install
cp .env.example .env                     # ANTHROPIC_API_KEY + felles token generator-bruker
cp configs/example.json configs/at22.json  # én per miljø: org, app, token/testbruker, API-nøkler
npm run explore:at22 -- charters/01-instans-og-data.md
npm run explore:at23 -- charters/01-instans-og-data.md
npm run explore:tt02 -- charters/01-instans-og-data.md
npm run explore -- charters/01-instans-og-data.md   # local (app-localtest)
```

## Miljøer

| Miljø | App-URL |
|---|---|
| `at22` | `https://{org}.apps.at22.altinn.cloud/{org}/{app}` |
| `at23` | `https://{org}.apps.at23.altinn.cloud/{org}/{app}` |
| `tt02` | `https://{org}.apps.tt02.altinn.no/{org}/{app}` |
| `local` | `TARGET_BASE_URL` (app-localtest) |

### Konfig per miljø

Alt miljøspesifikt ligger i **én JSON per miljø** (se [`configs/example.json`](configs/example.json)):
`org`, `app`, `token` *eller* `tokenGenerator` (testbruker-ID-er), hemmelige `headers` (f.eks. API-nøkler)
og flere `apis` agenten får teste (hver med egen base-URL og egne nøkler).

| Hvor | Felles | Per miljø |
|---|---|---|
| Lokalt | `.env` | `configs/at22.json`, `configs/at23.json`, `configs/tt02.json` (gitignored) |
| GitHub Actions | secrets `ANTHROPIC_API_KEY`, `TOKEN_GENERATOR_USERNAME`, `TOKEN_GENERATOR_PASSWORD` | secrets `QA_CONFIG_AT22`, `QA_CONFIG_AT23`, `QA_CONFIG_TT02` (hele JSON-en som verdi) |

Agenten ser bare API-navn og beskrivelser, aldri nøkler eller tokens. I Actions maskeres hvert hemmelige felt i loggen.
**Produksjon (altinn.no utenom tt02) blokkeres i koden**, også for ekstra `apis`.

## Start fra GitHub: `@qa-agent`

Kommenter på en issue eller PR:

```
@qa-agent at22 Utforsk innsending av skjema med ugyldige datoer
```

Workflowen (`.github/workflows/qa-agent.yml`) reagerer med 👀, kjører økten og svarer med rapporten.
Miljø er `at22` (standard), `at23` eller `tt02`; resten av kommentaren er charteret. På en PR legges diffen ved.
Kun OWNER/MEMBER/COLLABORATOR kan starte økter.

Oppsett i repoet (Settings → Secrets and variables → Actions): se tabellen under *Konfig per miljø*.

## Sikkerhet

- Agenten får bare snakke med appens vert i valgt miljø (håndheves i kode, ikke i prompt). Prod er sperret.
- Secrets (token, API-nøkler, token generator-passord, PID) legges på av verktøyet og vaskes ut av svar.
  **Claude ser dem aldri.** `.env` er gitignored.
- `DELETE` er av som standard (`QA_ALLOW_DELETE=false`).
- Innhold i API-svar behandles som data, ikke instruksjoner (prompt injection).
- Maks antall verktøykall per økt (`QA_MAX_STEPS`).

## Struktur

| Fil | Hva |
|---|---|
| `src/agent.ts` | Manuell agentløkke: `stop_reason`, `tool_use` → `tool_result`, caching, fallback |
| `src/env-config.ts` | Leser og validerer miljøets JSON-konfig, maskerer secrets i Actions |
| `src/environments.ts` | Miljøprofiler (at22/at23/tt02/local) og prod-sperre |
| `src/auth.ts` | Token per miljø: statisk eller via Altinn test token generator |
| `src/tools/http.ts` | `http_request` med vert-allowlist, auth-injeksjon og redaksjon |
| `src/tools/session.ts` | `record_note` / `report_finding` med `strict: true`-skjema |
| `src/prompts.ts` | Systemprompt: tester-persona og heuristikker |
| `src/report.ts` | Øktrapport (SBTM-format) |
| `charters/` | Testcharter, ett per økt |

## Veikart (= studieplan for eksamen)

- [x] **Uke 1 – API-grunnmur:** Messages API, manuell tool-løkke, HTTP-verktøy, rapport
- [ ] **Uke 2 – Tool use + strukturert output:** Playwright-verktøy (`navigate`, `click`, `fill`, `screenshot`, `read_page`), bilder inn i tool results
- [ ] **Uke 3 – Agenter/MCP:** orkestrator som lager charter fra `git diff`, utforsker-subagenter, verifikator-agent som reproduserer funn; prøv Playwright MCP
- [ ] **Uke 4 – Evals + sikkerhet:** demo-app med plantede feil → mål funnrate og falske positiver; prompt injection-tester; k6-verktøy for enkel last på interessante endepunkter
- [ ] **Uke 5 – Prøveeksamener**, svake domener
- [ ] **Uke 6 – Repetisjon og eksamen** (Pearson-testsenter, Glasspaper)
