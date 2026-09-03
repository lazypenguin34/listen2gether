// Thin re-export shim.
//
// The real config lives at frontend/eslint.config.base.js, alongside the
// ESLint/plugin devDependencies (declared only in frontend/package.json --
// there is deliberately no root package.json with dependencies). Node's ESM
// resolver looks for node_modules only in ancestor directories of the file
// doing the importing, never in a sibling directory, so a config file
// physically at the repo root cannot `import '@eslint/js'` etc. against
// frontend/node_modules. Re-exporting from a file that actually lives inside
// frontend/ sidesteps that: its own bare imports resolve normally.
//
// frontend/eslint.config.base.js also pins an absolute `basePath` on each of
// its config blocks (frontend/, backend/) so file matching is correct
// regardless of invocation directory. ESLint additionally requires every
// linted file to fall under the *overall* base path, which -- because we
// always pass --config explicitly -- is simply process.cwd(). Run ESLint
// with the repo root as cwd (see frontend/package.json's "lint" script) so
// that base path covers both frontend/ and backend/.
export { default } from './frontend/eslint.config.base.js';
