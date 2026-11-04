import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-expect-error - JS-modul uten typer (skriptene kjøres med ren node i CI)
import { flagCheckbox, flagEnabled, flagsInDiff, isFrontendFlag } from "../scripts/flags.mjs";

describe("feature-flagg", () => {
  it("finner flaggnavn bare i linjer diffen legger til", () => {
    const diff = [
      "+++ b/infra/frontend.tf",
      '+  { name = "AccessManagementUI.ShowRolesRemovedAlert" },',
      '-  { name = "AccessManagement.Gammelt" },',
      '+  public const string Logg = "AccessManagement.Enduser.ConnectionsActivityLogApi";',
      '+  var ns = "Altinn.AccessManagement.Core";',
    ].join("\n");
    assert.deepEqual(flagsInDiff(diff), [
      "AccessManagementUI.ShowRolesRemovedAlert",
      "AccessManagement.Enduser.ConnectionsActivityLogApi",
    ]);
    assert.ok(isFrontendFlag("AccessManagementUI.ShowRolesRemovedAlert"));
    assert.ok(!isFrontendFlag("AccessManagement.Enduser.ConnectionsActivityLogApi"));
  });

  it("leser avkrysningsboksen i issueteksten", () => {
    const box = flagCheckbox(["AccessManagement.X"], "at22");
    assert.equal(flagEnabled(`tekst\n${box}\n`), false);
    assert.equal(flagEnabled(box.replace("- [ ]", "- [x]")), true);
    assert.equal(flagEnabled("ingen boks"), undefined);
  });
});
