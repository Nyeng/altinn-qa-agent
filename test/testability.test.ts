import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-expect-error - JS-modul uten typer (skriptene kjøres med ren node i CI, uten installasjon)
import { CATEGORIES, classify } from "../scripts/pr-testability.mjs";

// Ekte eksempler fra altinn-auth.
const cases: [string, string, string[]][] = [
  [
    "funksjonell",
    "feat(pdp): open access-restriction to all callers",
    ["src/apps/Altinn.Authorization/src/A.cs", "src/apps/Altinn.Authorization/test/B.cs"],
  ],
  ["funksjonell", "bug(resource-registry): Fix next link", ["src/apps/Altinn.ResourceRegistry/src/C.cs"]],
  [
    "bak-flagg",
    "feat(roles)!: feature toggle to exclude Altinn 2 roles",
    ["infra/deploy/flags.tf", "src/apps/Altinn.AccessManagement/src/D.cs"],
  ],
  ["regresjon", "chore: run dotnet format", ["src/apps/Altinn.AccessManagement/src/E.cs"]],
  ["deploy", "fix: tidy authz manifests", ["src/apps/Altinn.Authorization/manifests/k.yaml"]],
  ["ikke-testbar", "fix(authorization): Unittests fail on MacOS", ["src/libs/Altinn.Authorization.Testing/src/F.cs"]],
  ["ikke-testbar", "ci: make it work", [".github/workflows/ci.yml"]],
  ["ikke-testbar", "test(bruno): add scenarios", ["src/apps/Altinn.AccessManagement/test/Bruno/x.bru"]],
];

describe("klassifisering av PR-er", () => {
  for (const [expected, title, files] of cases) {
    it(`${expected}: ${title}`, () => assert.equal(classify({ title, files }).category, expected));
  }

  it("kjører bare nye features/rettinger og flagg", () => {
    const run = Object.entries(CATEGORIES)
      .filter(([, c]) => (c as { run: boolean }).run)
      .map(([k]) => k);
    assert.deepEqual(run, ["funksjonell", "bak-flagg"]);
  });
});
