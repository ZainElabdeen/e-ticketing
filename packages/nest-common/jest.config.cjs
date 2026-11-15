const { jestCoverage } = require('@eticket/config/jest-coverage');

module.exports = {
  ...jestCoverage('unit'),
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // 151002: NodeNext modules need isolatedModules, which emitDecoratorMetadata rules out.
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }] },
};
