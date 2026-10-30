// Lokalt CLI for GUI-testing: henter testbrukere fra katalogen (samme kilde som Son of Vegard).
// Viser fødselsnummer, fordi det trengs for TestID-innlogging. Kun for lokal bruk - ikke i CI.
//
//   npx tsx scripts/testuser.mts kategorier at23
//   npx tsx scripts/testuser.mts hent at23 tilgangspakker-person [antall]
import { TestUserPool } from "../src/altinn/test-users.js";
import { isEnvName } from "../src/policy/environments.js";
import { Redactor } from "../src/policy/redact.js";

const [command, env, category, count = "1"] = process.argv.slice(2);
if (!env || !isEnvName(env) || (command === "hent" && !category) || !["kategorier", "hent"].includes(command)) {
  console.error("Bruk: testuser.mts kategorier <at22|at23|tt02>  |  testuser.mts hent <miljø> <kategori> [antall]");
  process.exit(1);
}

const pool = new TestUserPool({
  env,
  testdataBaseUrl: "https://raw.githubusercontent.com/Altinn/altinn-platform-validation-tests/refs/heads/main",
  redactor: new Redactor(),
});

if (command === "kategorier") {
  for (const c of pool.categories()) console.log(`${c.id.padEnd(28)} ${c.flow}`);
} else {
  const users = [];
  for (let i = 0; i < Number(count); i++) users.push(await pool.pick(category));
  console.log(JSON.stringify(users, null, 2));
}
