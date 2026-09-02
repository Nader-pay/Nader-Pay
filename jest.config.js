/** @type {import('jest').Config} */
export default {
  testMatch: ['**/src/services/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^react-native$': '<rootDir>/node_modules/react-native',
    // ESM stubs — لا يعملان في بيئة Node/Jest
    '^expo/fetch$': '<rootDir>/src/__mocks__/expo-fetch.js',
    '^expo-constants$': '<rootDir>/src/__mocks__/expo-constants.js',
  },
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { configFile: './babel.config.js' }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|miaoda-expo-devkit)',
  ],
  testEnvironment: 'node',
  extensionsToTreatAsEsm: [],
  // Mock global لـ remoteConfigService — يمنع ESM import errors في كل suite
  setupFiles: ['<rootDir>/src/__mocks__/remoteConfigSetup.js'],
};
