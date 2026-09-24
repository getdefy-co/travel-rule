const createQueryResult = (rows = [], overrides = {}) => ({
  rowCount: rows.length,
  rows,
  ...overrides,
});

const createTransactionClient = () => ({
  query: jest.fn(),
  release: jest.fn(),
});

const normalizeSql = sql => sql.replace(/\s+/g, ' ').trim();

export { createQueryResult, createTransactionClient, normalizeSql };
