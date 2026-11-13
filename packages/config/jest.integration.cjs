module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
  testTimeout: 180000,
  maxWorkers: 1,
};
