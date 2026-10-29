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

## Sikkerhet

- Kun testmiljøene at22, at23 og tt02.
- Tokens og nøkler sendes aldri til modellen.
- Ingenting som sender varsler eller e-post til ekte mottakere.
- `PUT`/`PATCH` kun mot data agenten selv har opprettet, `DELETE` kun for opprydding av egne `snoken-*`-ressurser.
