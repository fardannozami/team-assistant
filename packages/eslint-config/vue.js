import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import onlyWarn from "eslint-plugin-only-warn";
import turboPlugin from "eslint-plugin-turbo";
import vuePlugin from "eslint-plugin-vue";
import globals from "globals";

const config = [
  { ignores: ["dist/**"] },
  js.configs.recommended,
  prettier,
  ...vuePlugin.configs["flat/recommended"],
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
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
      "vue/multi-word-component-names": "off",
      "vue/max-attributes-per-line": "off",
    },
  },
];

export { config };
export default config;
export { config as vueConfig };
