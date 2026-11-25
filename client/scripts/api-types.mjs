// Turns the API contract (docs/api/openapi.json) into TypeScript types: src/lib/api.generated.ts.
// No dependencies on purpose (AGENTS.md rule 4); it covers exactly the schema shapes the API emits.
//   npm run gen:api            write the file
//   imported by api.generated.test.ts, which fails when the committed file is out of date.

import { argv } from "node:process";

const HEADER = "// Generated from docs/api/openapi.json by scripts/api-types.mjs — do not edit. Run `npm run gen:api`.\n";

function typeOf(schema) {
  if (!schema) return "unknown";
  if (schema.$ref) return schema.$ref.split("/").pop();
  if (schema.oneOf) return [...new Set(schema.oneOf.map(typeOf))].join(" | ");
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  // .NET writes integers as JSON numbers but documents that it also *reads* them from strings.
  const numeric = types.includes("integer") || types.includes("number");
  const parts = new Set();
  for (const t of types) {
    if (t === "null") parts.add("null");
    else if (t === "integer" || t === "number") parts.add("number");
    else if (t === "string") { if (!numeric) parts.add("string"); }
    else if (t === "boolean") parts.add("boolean");
    else if (t === "array") parts.add(`${wrap(typeOf(schema.items))}[]`);
    else if (t === "object") parts.add(objectType(schema, "  "));
  }
  if (parts.size === 0 && schema.properties) parts.add(objectType(schema, "  "));
  const list = [...parts];
  return list.length ? [...list.filter((p) => p !== "null"), ...list.filter((p) => p === "null")].join(" | ") : "unknown";
}

const wrap = (t) => (t.includes(" | ") ? `(${t})` : t);

function objectType(schema, indent) {
  if (!schema.properties) return schema.additionalProperties ? `Record<string, ${typeOf(schema.additionalProperties)}>` : "Record<string, unknown>";
  const required = new Set(schema.required ?? []);
  const lines = Object.entries(schema.properties).map(([name, prop]) => `${indent}${name}${required.has(name) ? "" : "?"}: ${typeOf(prop)};`);
  return `{\n${lines.join("\n")}\n${indent.slice(2)}}`;
}

export function generate(contract) {
  const schemas = contract.components?.schemas ?? {};
  const out = Object.keys(schemas).sort().map((name) => {
    const schema = schemas[name];
    return schema.properties ? `export interface ${name} ${objectType(schema, "  ")}` : `export type ${name} = ${typeOf(schema)};`;
  });
  return `${HEADER}\n${out.join("\n\n")}\n`;
}

if (import.meta.url === `file://${argv[1]}`) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const contract = JSON.parse(readFileSync(new URL("../../docs/api/openapi.json", import.meta.url), "utf8"));
  writeFileSync(new URL("../src/lib/api.generated.ts", import.meta.url), generate(contract));
  console.log("Wrote src/lib/api.generated.ts");
}
