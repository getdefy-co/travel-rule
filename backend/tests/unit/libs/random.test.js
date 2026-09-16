import random from '../../../src/libs/random';

describe('libs/random', () => {
  test('generates an alphanumeric string with the requested length', () => {
    const value = random.generateAlphanumeric(64);

    expect(value).toHaveLength(64);
    expect(value).toMatch(/^[A-Za-z0-9]+$/);
  });
});
