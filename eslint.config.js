import js from '@eslint/js';

export default [
  {
    ignores: ['.wrangler/**', 'node_modules/**', 'tmp/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        document: 'readonly',
        localStorage: 'readonly',
        matchMedia: 'readonly',
      },
    },
  },
];
