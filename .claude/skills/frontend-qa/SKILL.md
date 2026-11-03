---
name: frontend-qa
description: Planlagt, uovervåket frontend-QA - finner nye, deployede UI-endringer i altinn-access-management-frontend og GUI-tester dem lokalt. Bruk når en planlagt oppgave eller brukeren ber om "frontend-QA", "kjør frontend-QA" eller "test nye frontend-PR-er".
---

# Frontend-QA (lokalt, uovervåket)

Kjøres lokalt på brukerens Mac og abonnement - bruker ingen tokens via GitHub Actions. Det eneste som skrives til
GitHub er rapporten, som issue i `Nyeng/altinn-qa-agent` via `scripts/publish-gui.mjs` (aldri i Altinn-repoene).

Arbeidsmappe: repoet `altinn-qa-agent` (der denne skillen ligger). Kjør alle kommandoer derfra.

## Fremgangsmåte

1. **Finn kandidater:** `node scripts/amf-candidates.mjs at23 2`
   Gir maks 2 kandidater som ikke er testet før: PR-er i frontend-repoet (`kind: "PR"`) som er merget, synlige i
   UI og deployet til AT23, og lukkede frontend-Features i altinn-auth (`kind: "Feature"`). For en Feature: test
   akseptansekriteriene i Featuren og sub-issuene som helhet. Deploy kan ikke bekreftes - mangler noe i UI,
   registrer det som ⚪ med «ikke deployet?», ikke som funn.
   Tom liste → skriv «Ingen nye frontend-endringer å teste.» og avslutt. Ikke gjør noe mer.
   **`retest: true`** betyr at kandidaten er testet før og står i `reports/gui/retest.txt`. Les den eksisterende
   rapporten og test **bare ⚪-kravene** på nytt. Behold ✅/❌-linjene og funnene som de er, erstatt ⚪-linjene med
   de nye resultatene, legg til eventuelle nye funn, og skriv rapporten tilbake til samme fil. Etter publisering:
   fjern nøkkelen fra `reports/gui/retest.txt`.
2. **For hver kandidat:** følg arbeidsmåten og reglene i `.claude/skills/son-of-vegard-gui/SKILL.md` (les den),
   med disse unntakene fordi ingen er til stede:
   - **Aldri vent på svar eller spør brukeren.** Er noe uklart, gjør det tryggeste valget og noter det i rapporten.
   - **Stopp kandidaten (ikke hele kjøringen)** hvis innloggingen blokkeres, siden ikke laster, eller du havner
     på en prod-adresse. Skriv da en rapport med ⚪ og årsaken.
   - **Rapport:** skriv den til `reports/gui/<key>.md` (key fra kandidatlisten, f.eks.
     `reports/gui/amf-2581-at23.md`). Filen er også det som markerer kandidaten som testet. Skjermbilder lagres som
     `reports/gui/<key>-<navn>.png` og refereres med den stien i rapporten.
   - **Publiser:** `node scripts/publish-gui.mjs <key>`. Lager eller oppdaterer issuen (statuslinje + én
     rapportkommentar) og laster opp skjermbildene. Feiler publiseringen, noter det i oppsummeringen - ikke prøv
     andre veier.
   - **Dekk alle akseptansekriterier.** Ingen fast handlingsgrense (lokalt abonnement, ikke API-kostnad): test til
     hvert krav er ✅/❌ eller har en konkret ⚪-årsak (manglende testdata, flagg av, ikke deployet), som i
     API-rapportene. «Budsjett» er ikke en gyldig årsak. Sikkerhetsnett mot at kjøringen henger: stopp kandidaten
     etter ~200 nettleserhandlinger eller ~45 minutter, og skriv det som årsak på kravene som gjenstår.
3. **Nettleser:** bruk **`playwright-headless`** fra `.mcp.json` (skjult nettleser, så det virker på låst
   skjerm; tillatt-liste for testmiljøene, prod blokkert). Er den ikke tilgjengelig, bruk `playwright`, og
   deretter appens innebygde nettleser - med nøyaktig de samme reglene. Aldri prod.
4. **Til slutt:** skriv en kort oppsummering: hvilke PR-er som ble testet, og antall ✅ / ❌ / ⚪ og funn per PR,
   med lenke til issuene. Ingenting annet.

## Rapportformat (per PR, i filen)

Samme korte format som `son-of-vegard-gui`: overskrift, **Verifisert** (✅/❌/⚪ per krav) og **Funn**
(med reproduksjonssteg og skjermbilde-sti), uten oppsummering eller forslag.
