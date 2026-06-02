/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // The transport/terminal logic under test is pure TS (no React Native
  // runtime), so the lighter Node environment keeps these suites fast.
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Resolve the `@/*` path alias used throughout the app (see tsconfig.json).
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
