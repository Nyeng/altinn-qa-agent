# ADR 0001: Klientdata for funksjonell test

Status: Foreslått
Dato: 2026-11-04

## Kontekst

Klientdelegering er vanskelig å teste uten riktige data. Testen trenger en virksomhet med klienter, for eksempel en
revisor, regnskapsfører eller forretningsfører, og en person som kan logge inn på vegne av den. Til nå har Son of Vegard
måttet sette opp klientforhold selv (som `setUpClientRelation` i platform-validation-tests). Det gir klienten en
ressursrettighet, men ikke rollene fra Enhetsregisteret eller tilgangspakkene en ekte regnskapsfører eller revisor har.
Store deler av klientflytene kunne derfor ikke testes.

## Beslutning

Filene i [testdata/klientdelegering](../../testdata/klientdelegering) er testdata Son of Vegard kan bruke til
funksjonell og utforskende test av klientdelegering i at22, at23 og tt02, både i API-testene og GUI-testene.

- `<miljø>.csv` har én virksomhet med klienter per profil: `revisor`, `regnskapsforer`, `forretningsforer`,
  `revisor-jordbruk` (revisorklienter, noen med jordbrukspakker) og `egendefinert` (egendefinerte klienter med 1–3
  tilgangspakker). Hver rad har personen som logger inn (`pid`, `userId`, `partyId`, `partyUuid`), aktøren som skal
  velges (`orgNo`, `orgPartyId`, `orgUuid`) og antall klienter aktøren har (`clientCount`).
- `<profil>/<miljø>.csv` har et utvalg av klientene til den virksomheten: én klient per kombinasjon av klienttype,
  roller, ER-rolle pluss egendefinert relasjon (`hasErRoleAndCustom`) og tilgangspakker.

Alle personer og virksomheter er syntetiske Tenor-data. ID-ene er forskjellige i hvert miljø.

Testene kan endre delegeringer for disse brukerne i GUI-et, for eksempel gi en agent tilgang til en klient og fjerne den
igjen, og trenger ikke tilbakestille. Endringene skrives i rapporten. API-agenten følger fortsatt sine egne
skriveregler (PUT/PATCH bare mot egne data, DELETE bare for egne `snoken-*`-ressurser).

Dataene er ikke ment for ytelsestest av mange klienter. De to revisorene har rundt 5 500 og 6 000 klienter i
miljøene, men lista har bare utvalget. `clientCount` viser det reelle tallet.

## Konsekvenser

Klientflytene kan testes med realistiske virksomheter uten at hver økt bygger sine egne klientforhold. API-agenten får
noen av aktørens klienter i konteksten, og GUI-testeren vet hvilken aktør den skal velge. Dataene må lages på nytt hvis
miljøene nullstilles eller klientforholdene endres. ID-ene fylles da inn igjen med `node scripts/hent-klient-ider.mjs`.
