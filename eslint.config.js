const js = require('@eslint/js');
const globals = require('globals');

// Formatting is Prettier's job (see .prettierrc.json); ESLint only reports
// defects. ESLint 9 skips node_modules by default but does not read
// .gitignore, so generated directories are listed explicitly.
module.exports = [
  { ignores: ['build/', '.docusaurus/', 'exports/', '.vscode-test/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
