import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

// Lightweight, high-signal flat config: JS + typescript-eslint recommended (no
// type-checked rules, so it's fast and needs no project service) + the React Hooks
// correctness rules. `npm run lint` is now a real linter, distinct from `typecheck`.
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'docs/**', '**/*.config.js', '**/*.config.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The zero-dep Node proxy is plain ESM (.mjs) — give it Node globals so
    // js/recommended's no-undef doesn't fire on process/fetch/console.
    files: ['server/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        RequestInit: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // tsc's noUnusedLocals/noUnusedParameters already enforce unused symbols.
      '@typescript-eslint/no-unused-vars': 'off',
      // the LiveProvider scaffold intentionally types raw Graph rows as `any`.
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
