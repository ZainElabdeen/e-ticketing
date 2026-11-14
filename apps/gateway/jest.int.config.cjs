const base = require('@eticket/config/jest-integration');

module.exports = {
  ...base,
  preset: undefined,
  // 151002: NodeNext modules need isolatedModules, which emitDecoratorMetadata rules out.
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }] },
};
