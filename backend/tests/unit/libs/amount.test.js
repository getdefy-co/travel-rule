import { isPositiveIntegerAmount } from '../../../src/libs/amount';

test.each([
  ['1', true],
  [1, true],
  [String(Number.MAX_SAFE_INTEGER + 1), true],
  [Number.MAX_SAFE_INTEGER + 1, false],
  ['0', false],
  [0, false],
  ['1.5', false],
  [null, false],
])('validates precision-safe integer amount %p', (value, expected) => {
  expect(isPositiveIntegerAmount(value)).toBe(expected);
});
