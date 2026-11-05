import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import buttonHasType from './eslint-rules/button-has-type.js';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'custom': { rules: { 'button-has-type': buttonHasType } } },
    rules: {
      'custom/button-has-type': 'warn',
    },
  },
  {
    // One way to show money: `formatAmount` for amounts and `currencySymbol()` for a symbol typed or labelled by hand,
    // so a clinic's currency can be honoured in one place later. Only genuinely rupee-only surfaces (UPI, the money
    // module itself) and tests may name rupees directly.
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/domain/money.ts', 'src/components/Upi*.{ts,tsx}', 'src/**/*upi*.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'Literal[value=/₹/]', message: 'Use currencySymbol() or formatAmount() from @/domain/money, not a typed ₹.' },
        { selector: 'JSXText[value=/₹/]', message: 'Use {currencySymbol()} or formatAmount() from @/domain/money, not a typed ₹.' },
        { selector: 'TemplateElement[value.raw=/₹/]', message: 'Use ${currencySymbol()} or formatAmount() from @/domain/money, not a typed ₹.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/domain/money', '**/money'],
              importNames: ['formatINR'],
              message: 'Use formatAmount from @/domain/money. formatINR is for rupee-only surfaces such as UPI.',
            },
          ],
        },
      ],
    },
  }
);
