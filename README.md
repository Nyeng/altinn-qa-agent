# altinn-qa-agent

En utforskende tester og QA-agent for Altinn 3-apper, bygget direkte på Claude API.
Prosjektet er også studieprosjekt til **Claude Certified Developer – Foundations**.

Agenten tar et **charter** (session-based exploratory testing), utforsker appens API innenfor en
tidsboks, fører notater og rapporterer funn, og skriver en markdown-rapport til `reports/`.

## Kom i gang

```bash
npm install
cp .env.example .env   # fyll inn ANTHROPIC_API_KEY, TARGET_* (samme secrets som k6/Playwright)
npm run explore -- charters/01-instans-og-data.md
```

Kjør mot **app-localtest eller testmiljø, aldri prod.**

## Sikkerhet

- Agenten får bare snakke med verten i `TARGET_BASE_URL` (håndheves i kode, ikke i prompt).
- Secrets (`TARGET_BEARER_TOKEN` osv.) legges på av verktøyet og vaskes ut av svar.
  **Claude ser dem aldri.** `.env` er gitignored.
- `DELETE` er av som standard (`QA_ALLOW_DELETE=false`).
- Innhold i API-svar behandles som data, ikke instruksjoner (prompt injection).
- Maks antall verktøykall per økt (`QA_MAX_STEPS`).

## Struktur

| Fil | Hva |
|---|---|
| `src/agent.ts` | Manuell agentløkke: `stop_reason`, `tool_use` → `tool_result`, caching, fallback |
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
