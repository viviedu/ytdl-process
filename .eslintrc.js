module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 2020
  },
  extends: [
    'eslint:recommended'
  ],
  env: {
    node: true,
    es6: true,
    jest: true
  },
  rules: {
    'array-bracket-spacing': [
      'error',
      'never'
    ],
    'dot-notation': [
      'error'
    ],
    'eol-last': [
      'error',
      'always'
    ],
    'indent': [
      'error',
      2
    ],
    'keyword-spacing': [
      'error',
      {
        after: true,
        before: true
      }
    ],
    'no-multiple-empty-lines': [
      'error',
      {
        max: 1
      }
    ],
    'no-unused-vars': [
      'error',
      {
        args: 'none',
        caughtErrors: 'all',
        varsIgnorePattern: '^_'
      }
    ],
    'object-curly-spacing': [
      'error',
      'always'
    ],
    'quotes': [
      'error',
      'single'
    ],
    'semi': [
      'error',
      'always'
    ]
  }
};
