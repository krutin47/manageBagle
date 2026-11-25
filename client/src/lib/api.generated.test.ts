import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generate } from "../../scripts/api-types.mjs";

describe("generated API types", () => {
  it("match the committed API contract (run `npm run gen:api` after changing docs/api/openapi.json)", () => {
    const contract: unknown = JSON.parse(readFileSync(new URL("../../../docs/api/openapi.json", import.meta.url), "utf8"));
    const committed = readFileSync(new URL("./api.generated.ts", import.meta.url), "utf8");
    expect(committed).toBe(generate(contract));
  });
});
