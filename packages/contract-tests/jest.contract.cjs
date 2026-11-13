module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.contract-spec.ts'],
  testTimeout: 30000,
  maxWorkers: 1,
};
