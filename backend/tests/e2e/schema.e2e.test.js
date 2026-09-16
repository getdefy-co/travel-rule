import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { assertCanonicalSchema } from '../../src/bootstrap/schema';

const schema = `schema_e2e_${randomUUID().replaceAll('-', '')}`;
let databaseClient;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for schema e2e tests.');
  }

  databaseClient = new Client({ connectionString: process.env.DATABASE_URL });
  await databaseClient.connect();
  await databaseClient.query(`CREATE SCHEMA "${schema}"`);
  await databaseClient.query(`SET search_path TO "${schema}"`);
  await databaseClient.query(fs.readFileSync(path.resolve(__dirname, '../../src/schemas/database.sql'), 'utf8'));
});

afterAll(async () => {
  if (databaseClient) {
    await databaseClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await databaseClient.end();
  }
});

test('validates database.sql through a real PostgreSQL catalog query', async () => {
  await expect(assertCanonicalSchema(databaseClient)).resolves.toBeUndefined();
});

test('rejects a stale schema_migrations table', async () => {
  await databaseClient.query('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)');

  await expect(assertCanonicalSchema(databaseClient)).rejects.toThrow('Database schema is not canonical.');

  await databaseClient.query('DROP TABLE schema_migrations');
});
