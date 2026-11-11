import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-expect-error - ren JavaScript uten typer (scripts/ har ingen avhengigheter)
import { apiReferenceHints, cleanText, compactDiff } from "../scripts/charter-trim.mjs";

const file = (path: string, body: string) =>
  `diff --git a/${path} b/${path}\nindex 1..2 100644\n--- a/${path}\n+++ b/${path}\n${body}\n`;

describe("compactDiff", () => {
  const diff =
    file(
      "src/apps/Altinn.AccessManagement/src/Api/Controllers/RequestController.cs",
      '@@ -1,5 +1,6 @@ class X\n using A;\n-using Old;\n+using New;\n context\n-    [HttpPut("x")]\n+    /// Doc\n+    return BadRequest(Problems.NotPending);\n context',
    ) +
    file(
      "src/apps/Altinn.AccessManagement/test/RequestControllerTest.cs",
      "@@ -1 +1,2 @@\n+[Fact]\n+public void T() {}",
    ) +
    file("src/apps/Altinn.AccessManagement/src/Migrations/20261103_X.Designer.cs", "@@ -0,0 +1 @@\n+generated") +
    file("src/libs/Contracts/Errors/ValidationErrors.cs", "@@ -1 +1,2 @@\n+    RightKeyNotDelegableByUser = 56,");

  it("viser bare endrede linjer som sier noe om oppførsel, uten kontekst, using, attributter og dokumentasjon", () => {
    const out = compactDiff(diff);
    assert.match(out, /\+    return BadRequest\(Problems\.NotPending\);/);
    assert.doesNotMatch(out, /context|using|HttpPut|\/\/\/ Doc/);
  });

  it("tar kontrakter og feilkoder først, og lister tester og migreringer bare med navn", () => {
    const out = compactDiff(diff);
    assert.ok(out.indexOf("ValidationErrors.cs") < out.indexOf("RequestController.cs"));
    assert.match(out, /Utelatt .*RequestControllerTest\.cs \(\+2\/-0\), 20261103_X\.Designer\.cs \(\+1\/-0\)/);
    assert.doesNotMatch(out, /public void T|generated/);
  });

  it("holder seg under taket", () => {
    const big = file("src/apps/A/src/BigService.cs", `@@ -1 +1,999 @@\n${"+ line\n".repeat(999)}`);
    assert.ok(compactDiff(big + diff, { maxChars: 1000, maxPerFile: 600 }).length < 1400);
  });
});

describe("cleanText", () => {
  it("fjerner støyseksjoner med underseksjoner, kommentarer og details, men beholder resten", () => {
    const text = [
      "**TL;DR** Godkjenning med utvalg.",
      "<!-- mal -->",
      "## Please confirm",
      "1. Regelen fra 3638",
      "## Verified",
      "- dotnet build",
      "### Ikke kjørt",
      "- Bruno",
      "## AI assistance",
      "Claude skrev koden.",
      "<details><summary>Endringer</summary>mye</details>",
      "## Forslag til brukerflyt:",
      "### Bruker ber om tilgang",
      "GUI-tekst",
      "## Akseptansekriterier",
      "- 400 ved ugyldig nøkkel",
    ].join("\n");
    const out = cleanText(text, 10_000);
    for (const kept of ["TL;DR", "Please confirm", "Regelen fra 3638", "Akseptansekriterier", "400 ved ugyldig"]) {
      assert.ok(out.includes(kept), kept);
    }
    for (const gone of ["mal", "dotnet build", "Bruno", "Claude skrev", "mye", "brukerflyt", "GUI-tekst"]) {
      assert.ok(!out.includes(gone), gone);
    }
  });

  it("avkorter", () => {
    assert.equal(cleanText("x".repeat(50), 10), `${"x".repeat(10)}\n… [avkortet]`);
  });
});

describe("apiReferenceHints", () => {
  it("bruker klassenavn, ikke grensesnittprefiks, migreringer eller generiske ord", () => {
    const base = "src/apps/Altinn.AccessManagement/src/Altinn.AccessMgmt.Core";
    assert.deepEqual(
      apiReferenceHints([
        `${base}/Services/Contracts/IRequestService.cs`,
        `${base}/Services/RequestService.cs`,
        `${base}/Migrations/20261103054840_RequestAssignment.cs`,
        `${base}/Persistence/AppDbContext.cs`,
        `${base}/Utils/Helper/DelegationCheckHelper.cs`,
      ]),
      ["access-management request", "access-management delegation"],
    );
  });
});
