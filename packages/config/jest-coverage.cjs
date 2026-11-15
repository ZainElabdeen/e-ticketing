// Opt-in coverage (ADR-0025): off unless CI_COVERAGE=1, so local `pnpm test` stays fast.
function jestCoverage(kind) {
  return {
    collectCoverage: process.env.CI_COVERAGE === '1',
    coverageDirectory: `coverage/${kind}`,
    coverageReporters: ['lcov', 'text-summary'],
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/generated/**', '!src/main.ts'],
  };
}

module.exports = { jestCoverage };
