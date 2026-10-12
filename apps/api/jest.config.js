module.exports = {
  rootDir: ".",
  testRegex: "src/.*\\.spec\\.ts$",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  testEnvironment: "node",
};
