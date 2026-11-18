const base = require('./jest-e2e.json');

module.exports = {
  ...base,
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^\\./support/teacher-pdf-test-database$':
      '<rootDir>/support/teacher-feedback-integration-target.ts',
    '^\\./teacher-pdf-test-database$':
      '<rootDir>/support/teacher-feedback-integration-target.ts',
    '^\\./support/teacher-pdf-test-app$':
      '<rootDir>/support/teacher-feedback-integration-app.ts',
  },
};
