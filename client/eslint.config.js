import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "public"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  { languageOptions: { globals: globals.browser } },
  {
    // Shared code knows nothing about features (handbook §4.3): features may use lib/ and components/,
    // never the other way round.
    files: ["src/lib/**", "src/components/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/features/**"], message: "Shared code must not depend on a feature. Move what is shared into lib/ or components/." }] }],
    },
  },
);
