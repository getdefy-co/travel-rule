import * as database from '../../../src/database';

jest.mock('../../../src/database/auth', () => ({ __esModule: true, default: { getUser: jest.fn() } }));
jest.mock('../../../src/database/apiClient', () => ({ __esModule: true, default: { authenticate: jest.fn() } }));
jest.mock('../../../src/database/error', () => ({ __esModule: true, default: { writeError: jest.fn() } }));
jest.mock('../../../src/database/orchestration', () => ({ __esModule: true, default: { createTransferBundle: jest.fn() } }));
jest.mock('../../../src/database/reencryption', () => ({ __esModule: true, default: { createJob: jest.fn() } }));
jest.mock('../../../src/database/travelRuleEmail', () => ({ __esModule: true, default: { createJob: jest.fn() } }));
jest.mock('../../../src/database/postgres', () => ({ __esModule: true, pool: { query: jest.fn() } }));

describe('database/index', () => {
  test('exposes the Auth and Travel Rule database boundaries', () => {
    expect(Object.keys(database).sort()).toEqual(['apiClientDB', 'authDB', 'errorDB', 'orchestrationDB', 'pool', 'reencryptionDB', 'travelRuleDB', 'travelRuleEmailDB']);
    expect(database.apiClientDB.authenticate).toEqual(expect.any(Function));
    expect(Object.keys(database.authDB)).toEqual(['getUser']);
    expect(database.errorDB.writeError).toEqual(expect.any(Function));
    expect(database.orchestrationDB.createTransferBundle).toEqual(expect.any(Function));
    expect(database.reencryptionDB.createJob).toEqual(expect.any(Function));
    expect(database.travelRuleDB.consumeProtocolToken).toEqual(expect.any(Function));
    expect(database.travelRuleDB.getTransferByTokenDigest).toEqual(expect.any(Function));
    expect(database.travelRuleEmailDB.createJob).toEqual(expect.any(Function));
  });

  test('exposes only the main PostgreSQL pool through the postgres namespace', () => {
    expect(database.pool).toEqual(expect.objectContaining({ query: expect.any(Function) }));
  });
});
