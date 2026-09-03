import path from 'node:path';
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import unusedImports from 'eslint-plugin-unused-imports';
import eslintConfigPrettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';

// This file lives inside frontend/ (see ../eslint.config.js for why), but the
// glob patterns below must keep working no matter what directory ESLint is
// invoked from. Each config block below pins its own absolute `basePath`
// instead of relying on process.cwd() or the location of whichever file
// ESLint was pointed at with --config.
const FRONTEND_DIR = import.meta.dirname;
const ROOT_DIR = path.resolve(FRONTEND_DIR, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');

export default defineConfig([
    {
        basePath: ROOT_DIR,
        ignores: ['**/dist', '**/node_modules', '**/package-lock.json'],
    },
    {
        // Frontend: browser React app, ESM.
        basePath: FRONTEND_DIR,
        files: ['src/**/*.{js,jsx}'],
        extends: [
            js.configs.recommended,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
            eslintConfigPrettier,
        ],
        plugins: {
            react,
            'unused-imports': unusedImports,
        },
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
            parserOptions: {
                ecmaVersion: 'latest',
                ecmaFeatures: { jsx: true },
                sourceType: 'module',
            },
        },
        rules: {
            // Core no-unused-vars has no separate ignore pattern for imports: its
            // `varsIgnorePattern` also silences unused *imports* whose name matches,
            // which is exactly what let `import { BrowserRouter } from 'react-dom/client'`
            // sit undetected. Delegate to eslint-plugin-unused-imports instead: imports
            // are always reported, while the capitalized-name exemption is preserved
            // only for genuine local variables/constants.
            //
            // That split only works if JSX usage counts as a "use" in the first
            // place: without react/jsx-uses-vars, no-unused-vars (and this
            // plugin's replacement for it) has no idea that `<Foo />` reads the
            // `Foo` binding, so every component imported only for JSX would be
            // flagged as unused. We don't need the rest of eslint-plugin-react
            // (no react/jsx-uses-react — this project uses the modern JSX
            // transform — and no react/recommended), just this one rule.
            'react/jsx-uses-vars': 'error',
            'no-unused-vars': 'off',
            'unused-imports/no-unused-imports': 'error',
            'unused-imports/no-unused-vars': [
                'error',
                { vars: 'all', varsIgnorePattern: '^[A-Z_]', args: 'after-used' },
            ],
            // The rewrite in progress deliberately uses refs to avoid effect re-runs;
            // keep this visible without failing the build.
            'react-hooks/exhaustive-deps': 'warn',
        },
    },
    {
        // Backend: Node/CommonJS.
        basePath: BACKEND_DIR,
        files: ['src/**/*.js', 'test/**/*.js'],
        extends: [js.configs.recommended, eslintConfigPrettier],
        plugins: {
            'unused-imports': unusedImports,
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: globals.node,
        },
        rules: {
            'no-unused-vars': 'off',
            'unused-imports/no-unused-imports': 'error',
            'unused-imports/no-unused-vars': [
                'error',
                { vars: 'all', varsIgnorePattern: '^[A-Z_]', args: 'after-used' },
            ],
        },
    },
]);
