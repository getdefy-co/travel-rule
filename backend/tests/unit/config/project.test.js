import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import productionManifest from '../../../ecosystem.config';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const lintArrowBodyMessages = async (source, filePath) => {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(source, { filePath: path.join(root, filePath) });

  return result.messages.filter(message => message.ruleId === 'arrow-body-style');
};

describe('project runtime contract', () => {
  test('publishes the expected package identity and compiled production entrypoint', () => {
    const packageJson = JSON.parse(read('package.json'));

    expect(packageJson).toMatchObject({
      main: 'dist/index.js',
      name: 'travel-rule-backend',
      private: true,
      version: '1.0.0',
    });
    expect(packageJson.scripts).toMatchObject({
      dev: 'nodemon --exec babel-node src/index.js',
      start: 'node dist/index.js',
    });
    expect(packageJson.scripts['format:check']).toBe('prettier --check .');
    expect(Object.keys(packageJson.scripts).filter(script => script.startsWith('pm2'))).toEqual(['pm2:start']);
    expect(packageJson.dependencies).not.toEqual(expect.objectContaining({ axios: expect.anything(), dayjs: expect.anything(), lodash: expect.anything() }));
  });

  test('keeps Auth and TRP compatibility tables alongside the protocol-neutral orchestration schema', () => {
    const schema = read('src/schemas/database.sql');
    const tables = [...schema.matchAll(/CREATE TABLE\s+(\w+)/g)].map(match => match[1]);

    expect(tables).toEqual([
      'error_logs',
      'auth_users',
      'auth_reset_password_tokens',
      'auth_action_history',
      'trp_configuration',
      'travel_rule_transfers',
      'travel_rule_email_jobs',
      'travel_rule_tokens',
      'travel_rule_messages',
      'travel_rule_events',
      'api_clients',
      'api_client_credentials',
      'counterparties',
      'orchestration_transfers',
      'compliance_cases',
      'policy_decisions',
      'case_reviews',
      'protocol_exchanges',
      'protocol_messages',
      'delivery_attempts',
      'webhook_subscriptions',
      'outbox_jobs',
      'webhook_delivery_attempts',
      'audit_events',
      'encryption_reencryption_jobs',
    ]);
    expect(schema).not.toMatch(/auth_apikey|auth_usage|\bkey\s+TEXT|\bverified\b/i);
    expect(schema).toMatch(/session_version\s+INTEGER\s+NOT NULL\s+DEFAULT 0/i);
    expect(schema).toMatch(/token_digest\s+BYTEA\s+UNIQUE\s+NOT NULL/i);
    expect(schema).toMatch(/travel_rule_email_jobs[\s\S]*recipient_email_encrypted\s+JSONB\s+NOT NULL[\s\S]*token_encrypted\s+JSONB[\s\S]*token_digest\s+BYTEA\s+UNIQUE\s+NOT NULL/i);
    expect(schema).toMatch(/travel_rule_email_jobs[\s\S]*CHECK \(status IN \('queued', 'processing', 'failed', 'sent', 'dead_lettered', 'consumed'\)\)/i);
    expect(schema).not.toMatch(/\btoken\s+TEXT\s+UNIQUE\s+NOT NULL/i);
    expect(schema).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/i);
    expect(schema).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto/i);
    expect(schema).toMatch(/00000000-0000-4000-8000-000000000001[\s\S]*legacy-service-api-key[\s\S]*transfers:write/i);
    expect(schema).not.toMatch(/schema_migrations/i);
    expect(schema).not.toMatch(/ON CONFLICT \(id\) DO UPDATE SET scopes = EXCLUDED\.scopes/i);
    expect(fs.existsSync(path.join(root, 'src/database/migrations.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'src/migrations'))).toBe(false);
  });

  test('documents only the current authentication environment keys', () => {
    const envExample = read('.env.example');

    expect(envExample).toContain('SERVICE_API_KEY=replace-with-32-byte-random-hex');
    expect(envExample).not.toMatch(/VERA_FRONTEND_URL|DEMO_APIKEY|FOURWRD_API_KEY|FOURWRD_ENTITY_CODE/);
  });

  test('the production PM2 manifest runs the compiled API directly', () => {
    expect(productionManifest.apps).toHaveLength(1);
    expect(productionManifest.apps[0]).toMatchObject({ script: 'dist/index.js', interpreter: 'node' });
  });

  test('requires block bodies for production arrow functions only', async () => {
    await expect(lintArrowBodyMessages('const example = () => true;\n', 'src/lint-contract.js')).resolves.toEqual([expect.objectContaining({ severity: 2 })]);
    await expect(lintArrowBodyMessages('const example = () => { return true; };\n', 'src/lint-contract.js')).resolves.toEqual([]);
    await expect(lintArrowBodyMessages('const example = () => true;\n', 'tests/lint-contract.test.js')).resolves.toEqual([]);
  });
});
