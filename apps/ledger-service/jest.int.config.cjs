const base = require('@eticket/config/jest-integration');
const { jestCoverage } = require('@eticket/config/jest-coverage');

module.exports = {
  ...base,
  ...jestCoverage('int'),
  preset: undefined,
  // 151002: NodeNext modules need isolatedModules, which emitDecoratorMetadata rules out.
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }] },
};
