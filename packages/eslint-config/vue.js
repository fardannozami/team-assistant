import { fileURLToPath } from "node:url";
import babelParser from "@babel/eslint-parser";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import onlyWarn from "eslint-plugin-only-warn";
import turboPlugin from "eslint-plugin-turbo";
import vuePlugin from "eslint-plugin-vue";
import globals from "globals";

const config = [
  { ignores: ["dist/**"] },
  js.configs.recommended,
  ...vuePlugin.configs["flat/recommended"],
  // After the Vue presets, so it can switch off their formatting rules.
  prettier,
  {
    plugins: {
      turbo: turboPlugin,
      "only-warn": onlyWarn,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
      parserOptions: {
        // vue-eslint-parser hands <script> blocks to this; Babel strips the TS.
        parser: babelParser,
        requireConfigFile: false,
        babelOptions: {
          // Babel 8: treat .vue (any extension) as TypeScript.
          // Resolved here: Babel would look for it next to the app being linted.
          presets: [[fileURLToPath(import.meta.resolve("@babel/preset-typescript")), { ignoreExtensions: true }]],
        },
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
      "vue/multi-word-component-names": "off",
      "vue/max-attributes-per-line": "off",
      "vue/first-attribute-linebreak": "off",
      // Babel's scope analysis does not see TypeScript types, so these report
      // type annotations and type-only imports; the type checker covers them.
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
];

export { config };
export default config;
export { config as vueConfig };
