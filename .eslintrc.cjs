module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  ignorePatterns: ['node_modules/', 'out/', 'dist/', 'coverage/', 'refs/'],
  rules: {
    eqeqeq: ['error', 'smart'],
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-dupe-else-if': 'error',
    'no-duplicate-case': 'error',
    'no-unreachable': 'error',
    'valid-typeof': 'error',
  },
}
