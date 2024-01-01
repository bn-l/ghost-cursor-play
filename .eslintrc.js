module.exports = {
    "env": {
        "browser": true,
        "es2021": true,
    },
    "extends": [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended"
    ],
    "overrides": [
        {
            "env": {
                "node": true
            },
            "files": [
                ".eslintrc.{js,cjs}"
            ],
            "parserOptions": {
                "sourceType": "script"
            }
        }
    ],
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "ecmaVersion": "latest",
        "sourceType": "module"
    },
    "plugins": [
        "@typescript-eslint"
    ],
    "rules": {
        "@typescript-eslint/no-unused-vars": [
            "warn",
            {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
            },
        ],
        // forbid usage of unused variables (marked with an _)
        "@typescript-eslint/naming-convention": [
            "error",
            {
                selector: ["parameter", "variable"],
                leadingUnderscore: "forbid",
                filter: {
                    // keep this one open for destructuring
                    regex: "_*",
                    match: false
                },
                format: null,
            },
            {
                selector: "parameter",
                leadingUnderscore: "require",
                format: null,
                modifiers: ["unused"],
            },
        ],
    }
}
