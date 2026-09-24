module.exports = {
  env: {
    commonjs: true,
    node: true,
    es2021: true,
  },
  extends: 'airbnb-base',
  ignorePatterns: ['dist/'],
  overrides: [
    {
      files: ['src/**/*.js'],
      rules: {
        'arrow-body-style': ['error', 'always'],
      },
    },
    {
      files: ['tests/**/*.js'],
      env: {
        jest: true,
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 'latest',
  },
  rules: {
    'max-len': ['error', { code: 200 }],
    curly: ['error', 'all'],
    'brace-style': ['error', '1tbs', { allowSingleLine: false }],
    'padding-line-between-statements': ['error', { blankLine: 'always', prev: '*', next: 'if' }, { blankLine: 'always', prev: 'if', next: '*' }],
    'no-console': 'error',
    'no-plusplus': 'off',
    'no-param-reassign': [
      'error',
      {
        props: true,
        ignorePropertyModificationsFor: ['acc', 'accumulator', 'e', 'ctx', 'context', 'req', 'request', 'res', 'response', '$scope', 'staticContext', 'source', 'accounts'],
      },
    ],
    'no-unused-vars': [
      'error',
      {
        vars: 'all',
        args: 'after-used',
        ignoreRestSiblings: true,
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    'no-implicit-coercion': ['error', { boolean: false, number: true, string: true, allow: [] }],
    'no-promise-executor-return': 'error',
    'no-case-declarations': 'error',
    'no-unmodified-loop-condition': 'error',
    'no-useless-call': 'error',
    radix: 'error',
    'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx'], location: 'start' }],
    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: ['**/*.config.js', '**/.*rc.js', '.eslintrc.js', 'ecosystem.config.js', 'src/scripts/**', 'tests/**'],
      },
    ],
    'consistent-return': 'off',
    'no-nested-ternary': 'off',
    'no-await-in-loop': 'off',
    'no-continue': 'off',
    'object-curly-newline': 'off',
    camelcase: 'off',
    'implicit-arrow-linebreak': 'off',
    'function-paren-newline': 'off',
    'import/no-unresolved': 'off',
    'arrow-parens': ['error', 'as-needed'],
    'operator-linebreak': 'off',
    'import/prefer-default-export': 'off',
    'prefer-destructuring': 'off',
  },
};
