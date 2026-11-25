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
  {
    // Building blocks used by several pages (capture, timer) depend on no other feature.
    files: ["src/features/capture/**", "src/features/timer/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["../today/**", "../planner/**", "../backlog/**", "../routines/**", "../settings/**", "../review/**", "../week/**", "../guide/**", "../auth/**", "../shell/**"], message: "capture/ and timer/ are shared building blocks: they must not depend on a page feature." }] }],
    },
  },
  {
    // A page may use the building blocks and the Planner's block editor, but not another page.
    files: ["src/features/**"],
    ignores: ["src/features/capture/**", "src/features/timer/**", "src/features/shell/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{
        group: ["../today/**", "../backlog/**", "../routines/**", "../settings/**", "../review/**", "../week/**", "../guide/**", "../auth/**", "../shell/**"],
        message: "Pages do not import each other. Move what is shared into a building block (capture/, timer/) or into lib/ / components/.",
      }] }],
    },
  },
);
