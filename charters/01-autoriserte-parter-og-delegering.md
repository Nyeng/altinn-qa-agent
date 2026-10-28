**Utforsk** autoriserte parter og delegering av tilgangspakker for sluttbrukeren
**med** gyldige og ugyldige parter, parter brukeren *ikke* representerer, og forespørsler i "feil" rekkefølge
**for å finne** tilgangskontrollfeil (IDOR), valideringshull, uventede statuskoder og feilmeldinger som lekker interne detaljer.

Tips til økten:
- Start med `GET /accessmanagement/api/v1/enduser/authorizedparties` på `platform` for å se hvem brukeren kan representere.
- Se på tilkoblinger og tilgangspakker (`/accessmanagement/api/v1/enduser/connections` og BFF-en `am-bff`).
- Prøv samme kall med en party/UUID brukeren ikke har tilgang til - hva svarer API-et?
- Hva skjer med ugyldige UUID-er, tomme lister, ukjente pakker og dupliserte delegeringer?
