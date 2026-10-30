# Lokal trigger for pollingen

GitHubs planlagte workflows er upålitelige (forsinket i timevis eller hoppet over). Denne `launchd`-jobben
starter `snoken-polling.yml` fra Macen hver time kl. 07:05–16:05 lokal tid, mandag–fredag, med din `gh`-innlogging.
Den bruker ingen tokens - pollingen kjører i GitHub Actions og er gratis; Son of Vegard starter bare når noe skal testes.

Installer:

```bash
cp templates/launchd/no.nyeng.snoken-polling.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/no.nyeng.snoken-polling.plist
```

Test nå: `launchctl kickstart gui/$(id -u)/no.nyeng.snoken-polling` · Logg: `/tmp/snoken-polling.log`

Fjern:

```bash
launchctl bootout gui/$(id -u)/no.nyeng.snoken-polling && rm ~/Library/LaunchAgents/no.nyeng.snoken-polling.plist
```
