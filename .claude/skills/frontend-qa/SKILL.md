---
name: frontend-qa
description: Planlagt, uovervåket frontend-QA - finner nye, deployede UI-endringer i altinn-access-management-frontend og GUI-tester dem lokalt. Bruk når en planlagt oppgave eller brukeren ber om "frontend-QA", "kjør frontend-QA" eller "test nye frontend-PR-er".
---

# Frontend-QA (lokalt, uovervåket)

Kjøres lokalt på brukerens Mac og abonnement. Bruker ingen tokens via GitHub og skriver ingenting til GitHub
(ingen issues, kommentarer eller PR-er) - GitHub leses bare med `gh`.

Arbeidsmappe: repoet `altinn-qa-agent` (der denne skillen ligger). Kjør alle kommandoer derfra.

## Fremgangsmåte

1. **Finn kandidater:** `node scripts/amf-candidates.mjs at23 2`
   Gir maks 2 PR-er som er merget, synlige i UI, deployet til AT23 og ikke testet før.
   Tom liste → skriv «Ingen nye frontend-endringer å teste.» og avslutt. Ikke gjør noe mer.
2. **For hver kandidat:** følg arbeidsmåten og reglene i `.claude/skills/son-of-vegard-gui/SKILL.md` (les den),
   med disse unntakene fordi ingen er til stede:
   - **Aldri vent på svar eller spør brukeren.** Er noe uklart, gjør det tryggeste valget og noter det i rapporten.
   - **Stopp kandidaten (ikke hele kjøringen)** hvis innloggingen blokkeres, siden ikke laster, eller du havner
     på en prod-adresse. Skriv da en rapport med ⚪ og årsaken.
   - **Ikke post rapporten noe sted.** Skriv den til `reports/gui/<key>.md` (key fra kandidatlisten,
     f.eks. `reports/gui/amf-2581-at23.md`). Filen er også det som markerer PR-en som testet.
   - Hold deg til ~25 nettleserhandlinger per kandidat.
3. **Nettleser:** bruk Playwright MCP fra `.mcp.json` (tillatt-liste for testmiljøene, prod blokkert). Er det
   ikke tilgjengelig, bruk appens innebygde nettleser med nøyaktig de samme reglene - aldri prod.
4. **Til slutt:** skriv en kort oppsummering: hvilke PR-er som ble testet, og antall ✅ / ❌ / ⚪ og funn per PR,
   med sti til rapportfilene. Ingenting annet.

## Rapportformat (per PR, i filen)

Samme korte format som `son-of-vegard-gui`: overskrift, **Verifisert** (✅/❌/⚪ per krav) og **Funn**
(med reproduksjonssteg og skjermbilde-sti), uten oppsummering eller forslag.
