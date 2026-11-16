import config from '@eticket/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const FEATURES = ['shop', 'checkout', 'qr', 'result', 'backoffice'];

// Matches a folder import by any relative or alias path: '../checkout', '../../checkout/x'.
const folder = (name) => [`**/${name}`, `**/${name}/**`];

const restrict = (names, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: names.flatMap(folder), message }] }],
});

// Import direction (ADR-0028): app -> features -> shared. Tests and src/test wire providers
// across features, so they are exempt.
const boundaries = [
  {
    files: ['src/{ui,lib,api,styles,payment}/**/*.{ts,tsx}'],
    rules: restrict(
      [...FEATURES, 'app'],
      'Shared code must not import a feature or app/ (ADR-0028).',
    ),
  },
  ...FEATURES.map((feature) => ({
    files: [`src/${feature}/**/*.{ts,tsx}`],
    rules: restrict(
      [...FEATURES.filter((f) => f !== feature), 'app'],
      'Features must not import other features or app/; move shared code to payment/, lib/ or ui/ (ADR-0028).',
    ),
  })),
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

export default [
  ...config,
  reactHooks.configs.flat.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'vitest.setup.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  ...boundaries,
  {
    files: ['vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
];
