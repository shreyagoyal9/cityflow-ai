/**
 * Jest configuration.
 *
 * WHAT IS TESTED HERE, AND WHY ONLY THAT
 * These tests cover the PURE LOGIC modules — the recommendation engine, the
 * one-off trip planner, the savings estimator, the repair workflow state
 * machine, and time arithmetic. None of them touch the database, the network or
 * React.
 *
 * That is a deliberate boundary, not laziness. Those modules are where a silent
 * mistake would be most damaging and least visible: a wrong tie-break in the
 * engine sends thousands of people to the wrong slot and nothing looks broken.
 * A test suite that spun up Postgres to assert that Prisma can write a row
 * would take far longer to run and catch far less.
 *
 * The ML service has its own suite (`ml/tests`, pytest), including the tests for
 * the central smoothing claim.
 */

/** @type {import('jest').Config} */
export default {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  // @swc/jest rather than babel-jest or ts-jest: it reads the tsconfig paths
  // below, needs no babel config, and is fast enough that the suite is not
  // something anybody is tempted to skip.
  transform: {
    "^.+\\.(t|j)sx?$": ["@swc/jest", { jsc: { target: "es2022" } }],
  },
  moduleNameMapper: {
    // Mirrors the "@/*" path alias in tsconfig.json.
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  clearMocks: true,
  // A test that takes longer than this is doing something it should not.
  testTimeout: 10_000,
};
