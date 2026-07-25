import { defineConfig } from "oxlint";

/** @type {import("oxlint").OxlintConfig} */
export const oxlintConfig = {
    plugins: ["import", "oxc", "promise", "typescript"],
    categories: {},
    options: {
        typeAware: true,
    },
    rules: {
        "typescript/no-explicit-any": "off",
        "typescript/no-floating-promises": "off",
        "typescript/return-await": ["error", "in-try-catch"],
        "typescript/unbound-method": "off",
        "typescript/no-redundant-type-constituents": "off",
        "typescript/await-thenable": "off",
        "typescript/restrict-template-expressions": "off",
        "typescript/no-misused-spread": "off",
        "typescript/no-base-to-string": "off",
        "typescript/no-unused-vars": [
            "error",
            {
                args: "all",
                reportVarsOnlyUsedAsTypes: true,
                argsIgnorePattern: "^_",
                reportUsedIgnorePattern: true,
            },
        ],
    },
    env: {
        builtin: true,
    },
    globals: {},
    ignorePatterns: ["dist/**", "*.gen.*"],
};

export default defineConfig(oxlintConfig);
