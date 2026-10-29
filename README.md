# Son of Vegard (altinn-qa-agent)

En utforskende test-agent som verifiserer **nye features og rettinger** i
[Altinn/altinn-auth](https://github.com/Altinn/altinn-auth) (Autorisasjon og Tilgangsstyring) i testmiljøene,
via API-ene og med Claude API. Prosjektet er også studieprosjekt til **Claude Certified Developer – Foundations**.

Rapportene er korte: hva som er verifisert (mot akseptansekriteriene) og reproduserbare funn – ingenting annet.

## Slik fungerer det

```
altinn-auth                         Nyeng/altinn-qa-agent (dette repoet)
───────────                         ────────────────────────────────────
PR merget / Feature komplett   ──►  Polling hver time (07–16, man–fre)
/snoken-kommentar (valgfritt)        │  klassifiser PR → kjøres den?
                                     │  vent til koden er deployet
                                     ▼
                                    Issue her (forespørsel + status)
                                     │
                                     ▼
                                    Son of Vegard kjører i GitHub Actions
                                     │  testbrukere, tokens, API-kall
                                     ▼
                                    Én rapportkommentar i issuen
```

1. **Finner oppgaver selv** – ingen kommando nødvendig:
   - PR-er i altinn-auth som er merget og **testbare** (se under), testet i `at22`.
   - **Features** der alle sub-issues er lukket – testet ende-til-ende mot akseptansekriteriene.
   - Manuelt: `/snoken`-kommentarer på PR-er/issues i altinn-auth (kun fra godkjente brukere).
2. **Venter til koden er ute:** PR-en må være merget og merge-commiten deployet til miljøet
   (GitHub-deployments som `authorization/at22`, regnet som ute 10 min etter registrering). Apper uten
   deployment-sporing (f.eks. resource-registry) starter 10 min etter merge, med merknad.
3. **Henter kravene** fra issuet PR-en lukker og **Featuren** over det ([ADR-0004](https://github.com/Altinn/altinn-auth/blob/main/docs/adr/0004-issue-and-label-model.md)).
   Krav som andre PR-er i Featuren skal dekke, står som «ikke testet» – ikke som feil.
4. **Tester** med syntetiske testbrukere og direkte API-kall, og **rapporterer** i én kommentar i issuen.

## Hva testes – og hva ikke

PR-er klassifiseres automatisk ut fra filstier og commit-type ([`scripts/pr-testability.mjs`](scripts/pr-testability.mjs)).
Andelene er fra de 80 siste mergede PR-ene i altinn-auth:

| | Kategori | Andel | Kjøres? | Hvorfor |
|---|---|---:|:-:|---|
| 🟢 | **Funksjonell endring** (`feat`/`fix` i appkode) | ~10 % | ✅ | Ny eller rettet oppførsel – verifiseres mot akseptansekriteriene |
| 🟡 | **Bak feature-flagg** | ~4 % | ✅ | Sjekker først om flagget er på i miljøet; er det av, blir kravene «ikke testet» |
| 🟠 | Teknisk endring i kode (formatering, avhengigheter, refaktorering) | ~18 % | ❌ | Regresjon dekkes av teamets eksisterende tester |
| 🔵 | Deploy/infrastruktur (manifester, containere, terraform) | ~19 % | ❌ | Dekkes av eksisterende tester etter deploy |
| ⚪ | Ikke testbar (CI, tester, dokumentasjon, verktøy) | ~50 % | ❌ | Ingen endring i kjørende kode |

**Omtrent 1 av 7 PR-er kjøres.** For de som ikke kjøres, lukkes forespørselen med kategori og begrunnelse.
Overstyr med `tving` eller `kategori:<navn>` i en `/snoken`-kommentar.

## Rapporten

Én kommentar per issue, som oppdateres ved ny kjøring. Status står i én linje øverst i issueteksten.

```
### 🕵️ PR #4613 🟢 · at22

**Verifisert**
- ✅ Siste side med innhold (delvis full) har next-lenke
- ✅ Siste side akkurat full har next-lenke
- ⚪ Ikke testet: paginering med ugyldig token

**Funn**
- 🐞 **POST med orgnr med mellomrom foran gir 500** (middels) – forventet 201, faktisk 500
  ▸ Reproduser (curl + svarutdrag, sammenfoldet)

claude-sonnet-5-5 · 4 kall · $0.07 · logg
```

- Forespørsler og svar hentes fra HTTP-loggen via kall-ID-er – rapporten kan ikke inneholde resultater som ikke
  faktisk skjedde.
- Et ✅ krever at agenten kan forklare **hvordan kallene traff den endrede koden** (f.eks. «limit=1 på siste
  element»). Ellers blir kravet ⚪ «ikke testet».
- Returnerer et API tokenet eller en nøkkel, vises en tydelig markør, og det rapporteres som lekkasje.
- Alle detaljer (dekning per krav, hele HTTP-loggen) ligger i `session.json` i artefakten til kjøringen.

## Starte manuelt

Kommentar på en PR eller issue i altinn-auth (plukkes opp av pollingen) eller på en issue her:

```
/snoken at22 Verifiser trim av orgnr ved POST og PUT, sjekk lagret verdi med GET. maks 8 steg
```

- Miljø rett etter kommandoen: `at22`, `at23` eller `tt02` (standard `at23`).
- `maks N steg` setter grensen for antall verktøykall.
- `tving` kjører også PR-er som ellers ikke kjøres. `kategori:<navn>` overstyrer kategorien.

Eller **Actions → Son of Vegard → Run workflow** med feltene miljø, charter, PR-lenke, Feature-lenke,
maks steg og modell.

## Miljøer og konfig

| Miljø | `platform` | `am-bff` |
|---|---|---|
| `at22` | `https://platform.at22.altinn.cloud` | `https://am.ui.at22.altinn.cloud/accessmanagement/api/v1` |
| `at23` | `https://platform.at23.altinn.cloud` | `https://am.ui.at23.altinn.cloud/accessmanagement/api/v1` |
| `tt02` | `https://platform.tt02.altinn.no` | `https://am.ui.tt02.altinn.no/accessmanagement/api/v1` |

**Secrets** (Settings → Secrets and variables → Actions):

| Secret | Innhold |
|---|---|
| `ANTHROPIC_API_KEY` | Nøkkel fra et eget workspace i Claude Console, med månedlig betalingsgrense |
| `TOKEN_GENERATOR_USERNAME` / `TOKEN_GENERATOR_PASSWORD` | Altinn test token generator – felles for alle miljøer (som i platform-validation-tests) |
| `QA_CONFIG_AT22` / `QA_CONFIG_AT23` / `QA_CONFIG_TT02` | Miljøkonfig i **K6-formatet** fra platform-validation-tests, **på én linje** |

Miljøkonfigen (se [`configs/example.json`](configs/example.json)) er valgfri:
`BASE_URL`, `AM_UI_BASE_URL`, `REGISTER_SUBSCRIPTION_KEY` (brukes på `/register/...`),
`AUTHORIZATION_SUBSCRIPTION_KEY` (brukes på `/authorization/...`), og ev. en egen testbruker (`TEST_USER_*`).
Ukjente nøkler (f.eks. `SOAP_ER_*`) ignoreres, men behandles som hemmelige.

**Variabler** (valgfrie): `SNOKEN_AUTO` (`false` slår av automatikken), `SNOKEN_AUTO_ENV` (standard `at22`),
`SNOKEN_DAILY_MAX` (standard 5), `SNOKEN_DEPLOY_DELAY_MINUTES` (standard 10), `SNOKEN_ALLOWED_USERS` (standard `Nyeng`).

## Testbrukere etter brukerflyt

Syntetiske testbrukere hentes fra testdataene i
[altinn-platform-validation-tests](https://github.com/Altinn/altinn-platform-validation-tests) (samme kilde som K6),
gruppert etter brukerflyt ([`src/testdata-catalog.ts`](src/testdata-catalog.ts)):

| Kategori | Brukerflyt | at22 | at23 | tt02 |
|---|---|:-:|:-:|:-:|
| `tilgangspakker-person` / `-virksomhet` | Tilgangspakker | | ✓ | ✓ |
| `enkeltrettigheter`, `instansdelegering` | Enkeltrettigheter og tilgang til enkeltinstanser | | ✓ | ✓ |
| `klientadministrasjon`, `klient-agent` | Regnskapsfører/revisor og ansatte med klienter | ✓ | ✓ | ✓ |
| `samtykke`, `forespørsler` | Samtykke og tilgangsforespørsler | ✓ | ✓ | ✓ |
| `aktivitetslogg` | Brukere med historikk | ✓ | ✓ | |
| `partsstruktur-grenser` | Firma, underenheter, klienter – og parter brukeren **ikke** skal nå | ✓ | ✓ | ✓ |
| `systembruker` | Godkjenning av systembrukere | ✓ | ✓ | ✓ |
| `daglig-leder`, `privatperson` | Bred tilgang, og ingen roller | delvis | delvis | ✓ |

Agenten kan hente flere brukere og bytte mellom dem for å teste tilgangskontroll, og opptre som tjenesteeier
(TTD, virksomhetstoken) mot ressursregisteret. Den ser alias, ID-er og tilknyttede parter – **aldri fødselsnummer**.

## Sikkerhet

Håndheves i koden, ikke i prompten:

- **Kun testmiljøer:** verter er hardkodet til `*.at22.altinn.cloud`, `*.at23.altinn.cloud` og `*.tt02.altinn.no`
  (kun https). Prod og andre nettsteder er umulig.
- **Kun godkjente repoer:** kjører bare i `Nyeng/altinn-qa-agent` og `Altinn/altinn-auth`, og bare for godkjente
  brukere.
- **Hemmeligheter når aldri modellen:** tokens og nøkler legges på av verktøyet og vaskes ut av alle svar.
  I Actions maskeres hvert hemmelige felt i loggen.
- **Endringer er avgrenset:**
  - `PUT`/`PATCH` kun mot data agenten har opprettet med `POST` i samme økt – eksisterende og delte testdata
    kan bare leses.
  - `DELETE` kun for opprydding av egne `snoken-*`-ressurser.
  - Begge sjekkes på den normaliserte URL-en (stopper `../`- og `%2e`-triks).
- **Prompt injection:** innhold i API-svar, PR-tekst og diff behandles som data, ikke instruksjoner.
- **Grenser:** maks antall verktøykall og tokens per økt, maks 3 økter per polling og 5 per dag.

## Kostnad

Standard er `claude-sonnet-5-5` med `QA_EFFORT=low`, maks 25 verktøykall og 400 000 tokens per økt.
Agenten kan be om bare utvalgte felter fra store API-svar (`fields`), og hente mer fra et lagret svar uten nytt
kall (`inspect_call`). En typisk økt koster **$0.05–0.10** (estimat i hver rapport; fasit i Claude Console).
Bruk i tillegg forhåndsbetalt kreditt uten auto-reload og en månedlig grense på eget workspace.

## Kjøre lokalt

```bash
npm install
cp .env.example .env                       # ANTHROPIC_API_KEY + token generator-bruker
cp configs/example.json configs/at22.json  # valgfritt: subscription keys
npm run explore -- --env=at22 charters/01-autoriserte-parter-og-delegering.md
```

## Struktur

| Fil | Hva |
|---|---|
| `src/agent.ts` | Manuell agentløkke: `stop_reason`, `tool_use` → `tool_result`, caching, fallback, grenser |
| `src/prompts.ts` | Systemprompt: arbeidsmåte, testheuristikker, testbrukere |
| `src/tools/http.ts` | `http_request` og `inspect_call`, med sikkerhetsregler, auth og redigering |
| `src/tools/fields.ts` | Utvalg av felter fra JSON-svar |
| `src/tools/users.ts` | `pick_test_user`, `switch_user`, `use_service_owner` |
| `src/tools/session.ts` | `record_check` og `report_finding` |
| `src/testusers.ts`, `src/testdata-catalog.ts` | Testbrukere etter brukerflyt |
| `src/auth.ts` | Tokens fra Altinn test token generator |
| `src/config.ts`, `src/env-config.ts`, `src/environments.ts`, `src/guard.ts` | Konfig, miljøer, vert- og repo-sperrer |
| `src/report.ts`, `src/pricing.ts` | Kort rapport og estimert pris |
| `scripts/poll-altinn-auth.mjs` | Polling: finner oppgaver, venter på deploy, starter økter |
| `scripts/pr-testability.mjs` | Klassifisering av PR-er |
| `scripts/charter-from-comment.mjs` | Bygger charteret (krav fra issue/Feature, PR-diff, kategori) |
| `scripts/altinn.mjs`, `scripts/publish.mjs` | Oppslag i altinn-auth, og publisering i issuen |
| `.github/workflows/` | `snoken.yml` (økt) og `snoken-polling.yml` (polling) |
| `templates/altinn-auth/` | Workflow for å kjøre direkte i altinn-auth (krever teamet) |

## Veikart (= studieplan for eksamen)

- [x] **API-grunnmur:** Messages API, manuell tool-løkke, HTTP-verktøy, rapport, miljøer
- [x] **Tool use og strukturert output:** strenge skjemaer, testbrukere, tjenesteeier, `fields`
- [x] **Automatisering:** polling, deploy-sjekk, klassifisering, krav fra Features
- [ ] **Agenter/MCP:** underagent for testdata (Tenor), Playwright for UI-delen av Features
- [ ] **Evals:** plantede feil → mål funnrate og falske positiver
- [ ] **Prøveeksamener og eksamen** (Pearson-testsenter, Glasspaper)
