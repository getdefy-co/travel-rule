import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import jest from "eslint-plugin-jest";
import jestDom from "eslint-plugin-jest-dom";
import jsxA11y from "eslint-plugin-jsx-a11y";
import testingLibrary from "eslint-plugin-testing-library";
import unusedImports from "eslint-plugin-unused-imports";

const codeFiles = ["**/*.{js,jsx,mjs,cjs}"];
const jsxFiles = ["src/**/*.jsx"];
const testFiles = ["__tests__/**/*.{js,jsx}"];

const jestRecommended = jest.configs["flat/recommended"];
const testingLibraryReact = testingLibrary.configs["flat/react"];
const jestDomRecommended = jestDom.configs["flat/recommended"];

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...nextVitals,
  {
    name: "defy/linter-options",
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
  },
  {
    name: "defy/code-quality",
    files: codeFiles,
    plugins: {
      "unused-imports": unusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-duplicate-imports": "error",
      "object-shorthand": ["error", "always"],
      "prefer-const": "error",
    },
  },
  {
    name: "defy/accessibility",
    files: jsxFiles,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    ...jestRecommended,
    name: "defy/jest",
    files: testFiles,
    rules: {
      ...jestRecommended.rules,
      "jest/expect-expect": "error",
      "jest/no-commented-out-tests": "error",
      "jest/no-disabled-tests": "error",
      "jest/no-focused-tests": "error",
    },
  },
  {
    ...testingLibraryReact,
    name: "defy/testing-library",
    files: testFiles,
    rules: {
      ...testingLibraryReact.rules,
      "testing-library/no-debugging-utils": "error",
    },
  },
  {
    ...jestDomRecommended,
    name: "defy/jest-dom",
    files: testFiles,
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "node_modules/**", "next-env.d.ts"]),
]);

export default eslintConfig;
