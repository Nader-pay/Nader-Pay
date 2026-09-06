// https://docs.expo.dev/guides/using-eslint/
/* eslint-disable no-undef */
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  // تعريف globals لملفات الاختبار والـ mocks
  {
    files: [
      "**/__tests__/**/*.[jt]s?(x)",
      "**/*.test.[jt]s?(x)",
      "**/*.spec.[jt]s?(x)",
      "**/__mocks__/**/*.[jt]s",
      "jest.setup.*",
    ],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
      },
    },
  },
  // globals لملفات CJS (eslint.config.js نفسه والـ mocks)
  {
    files: ["eslint.config.js", "babel.config.js", "metro.config.js", "jest.config.*", "**/__mocks__/**/*.js"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "writable",
        exports: "writable",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
      },
    },
  },
]);
