module.exports = {
    extends: ["@commitlint/config-conventional"],
    rules: {
        "type-enum": [
            2,
            "always",
            ["build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "style", "test", "RALPH"],
        ],
        "subject-case": [0],
        "type-case": [0],
    },
};
