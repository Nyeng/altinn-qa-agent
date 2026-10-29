import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectFields } from "../src/tools/fields.js";

const body = JSON.stringify({
  data: [{ id: "a" }, { id: "b" }, { id: "c" }],
  links: { next: "https://x/?token=Mw" },
  meta: { count: 3 },
});

describe("selectFields", () => {
  it("henter felt, antall, første/siste og alle", () => {
    const out = selectFields(body, ["links.next", "data.#", "data[0].id", "data[-1].id", "data[*].id", "meta.#"]);
    assert.equal(
      out,
      [
        'links.next = "https://x/?token=Mw"',
        "data.# = 3",
        'data[0].id = "a"',
        'data[-1].id = "c"',
        'data[*].id = ["a","b","c"]',
        "meta.# = 1",
      ].join("\n"),
    );
  });

  it("viser manglende stier i stedet for å feile", () => {
    assert.equal(
      selectFields(body, ["data[9].id", "finnes.ikke"]),
      "data[9].id = (finnes ikke)\nfinnes.ikke = (finnes ikke)",
    );
  });

  it("returnerer undefined for svar som ikke er JSON", () => {
    assert.equal(selectFields("<html/>", ["a"]), undefined);
  });
});
