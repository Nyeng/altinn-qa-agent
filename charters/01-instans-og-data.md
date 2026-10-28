**Utforsk** opprettelse av instanser og lagring av skjemadata via app-API-et
**med** gyldige, ugyldige og grenseverdi-data, samt forespørsler i "feil" rekkefølge
**for å finne** valideringshull, uventede statuskoder og feilmeldinger som lekker interne detaljer.

Tips til økten:
- Start med `GET {appPath}/api/v1/applicationmetadata` for å forstå datatyper og prosess.
- Prøv å opprette en instans, hent den, og skriv data til dataelementet.
- Hva skjer med tomme felt, altfor lange verdier, æøå/emoji, feil datatyper og ukjente felt?
- Hva skjer om du endrer data etter at prosessen er flyttet videre?
