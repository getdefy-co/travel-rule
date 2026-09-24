import * as libs from '../../../src/libs';

jest.mock('../../../src/libs/logger', () => ({ __esModule: true, default: { kind: 'logger' } }));
jest.mock('../../../src/libs/mailer', () => ({ __esModule: true, default: { kind: 'mailer' } }));
jest.mock('../../../src/libs/morganMiddleware', () => ({ __esModule: true, default: { kind: 'morgan' } }));
jest.mock('../../../src/libs/random', () => ({ __esModule: true, default: { kind: 'random' } }));

describe('libs index', () => {
  test('exposes only auth runtime adapters', () => {
    expect(Object.keys(libs).sort()).toEqual(['jwt', 'logger', 'mailer', 'morganMiddleware', 'password', 'random', 'sanitizer'].sort());
    expect(libs.logger).toEqual({ kind: 'logger' });
    expect(libs.random).toEqual({ kind: 'random' });
  });
});
