# Son of Vegard

Test-agent som verifiserer nye features og rettinger i [Altinn/altinn-auth](https://github.com/Altinn/altinn-auth)
mot API-ene i testmiljøet, med Claude API. Resultatet er en kort rapport: hva som er verifisert, og funn.

## Slik fungerer det

1. En polling (hver time, 07–16 man–fre) finner mergede PR-er og komplette Features i altinn-auth,
   eller `/snoken`-kommentarer.
2. Den venter til koden er deployet til testmiljøet.
3. Agenten tester mot akseptansekriteriene (fra issuet eller Featuren) og poster rapporten som en issue i dette repoet.
   Hvordan API-ene brukes, slår den opp i [altinn-platform-validation-tests](https://github.com/Altinn/altinn-platform-validation-tests)
   – alle Altinn-produktene, ingenting kopiert.
4. Åpne issues med label `mulig-bug` er rapporter med nye funn som ikke er meldt i altinn-auth fra før, og som må
   ses på manuelt. Det som venter, kjører eller er ferdig uten nye funn, er lukket. Endringer bak frontend-flagg og
   Features uten ny API-oppførsel får ingen issue. Bak backend-flagg venter testen til du krysser av i issuen at
   flagget er på i miljøet. Forbedringer av agenten selv har label `agent-forbedring`.

## Hva testes

|     | Kategori                  | Andel av PR-er |              Kjøres              |
| --- | ------------------------- | -------------: | :------------------------------: |
| 🟢  | Funksjonell endring       |          ~10 % |                ✅                |
| 🟡  | Bak feature-flagg         |           ~4 % |                ✅                |
| 🟠  | Teknisk endring i kode    |          ~18 % | ❌ dekkes av eksisterende tester |
| 🔵  | Deploy/infrastruktur      |          ~19 % | ❌ dekkes av eksisterende tester |
| ⚪  | CI, tester, dokumentasjon |          ~50 % |                ❌                |

Basert på de 80 siste mergede PR-ene. Klassifiseringen ligger i [`scripts/pr-testability.mjs`](scripts/pr-testability.mjs).

## Eksempel på rapport

```
### 🕵️ PR #4613 🟢 · at22

**Verifisert**
- ✅ Siste side med innhold har next-lenke
- ✅ Tom side har ikke next-lenke

**Funn**
- Ingen

claude-sonnet-5-5 · 4 kall · $0.07 · logg
```

## Starte manuelt

Kommenter på en PR eller issue: `/snoken at22 <hva som skal testes>`, eller bruk **Actions → Son of Vegard → Run workflow**.

## Kjøre lokalt

```bash
npm install
cp .env.example .env   # ANTHROPIC_API_KEY, TOKEN_GENERATOR_USERNAME/PASSWORD
npm run explore -- --env=at22 charters/01-autoriserte-parter-og-delegering.md
```

## API-test lokalt i Claude Code (MCP)

Agentens verktøy kan også brukes direkte fra Claude Code, uten agentløkka og uten Claude API-nøkkel. [`.mcp.json`](.mcp.json)
har én server per miljø: `altinn-at22`, `altinn-at23` og `altinn-tt02`. Hver server er én økt mot ett miljø, med de
samme verktøyene, sperrene og maskeringen som agenten i GitHub Actions.

1. `npm install`, og legg `TOKEN_GENERATOR_USERNAME/PASSWORD` i `.env` (eller i miljøet). Subscription keys kommer fra
   `configs/<miljø>.json` som før.
2. Åpne Claude Code i dette repoet og godkjenn serveren for miljøet du skal teste når Claude Code spør (eller legg
   den til i `enabledMcpjsonServers` i `.claude/settings.local.json`).
3. Be Claude teste noe i miljøet, f.eks. «hent en bruker fra forespørsler og sjekk sent/count i at22».

Token og nøkler holdes i serverprosessen og vises aldri i samtalen. Serveren husker hva den har opprettet bare så
lenge den kjører, så PUT/PATCH/DELETE mot data fra før en omstart blir avvist.

## GUI-test lokalt

Frontend (altinn-access-management-frontend) testes lokalt i Claude Code på eget abonnement – ikke via GitHub.
Åpne Claude Code i dette repoet og kjør `/son-of-vegard-gui <PR-lenke> at23`. Nettleseren (Playwright MCP) er
konfigurert i [`.mcp.json`](.mcp.json) med prod blokkert; testbrukere hentes med `npx tsx scripts/testuser.mts`.
Universell utforming (WCAG 2.1 A/AA) testes også: axe-core lastes i alle sider fra `node_modules` (kjør `npm install`
først), og [`scripts/uu-init.js`](scripts/uu-init.js) gir `window.snokenUu(selektor)` med kompakte brudd.

Testdata for klientdelegering (revisor, regnskapsfører, forretningsfører og egendefinerte klienter) ligger i
[`testdata/klientdelegering`](testdata/klientdelegering), se
[ADR 0001: Klientdata for funksjonell test](docs/adr/0001-klientdata-for-funksjonell-test.md).

## Sikkerhet

- Kun testmiljøene at22, at23 og tt02.
- Tokens og nøkler sendes aldri til modellen.
- Ingenting som sender varsler eller e-post til ekte mottakere.
- `PUT`/`PATCH`/`DELETE` kun mot data agenten selv har opprettet i økten, f.eks. for å teste tilbaketrekking.
