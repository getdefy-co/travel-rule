import http from 'node:http';
import https from 'node:https';
import { createHttpServer, createPublicTlsServer } from '../../src/server';

jest.mock('node:http', () => ({ createServer: jest.fn(() => ({ kind: 'http' })) }));
jest.mock('node:https', () => ({ createServer: jest.fn(() => ({ kind: 'https' })) }));

const app = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

test('creates an internal HTTP server independently of protocol mode', () => {
  const server = createHttpServer(app);

  expect(server).toEqual({ kind: 'http' });
  expect(http.createServer).toHaveBeenCalledWith(app);
  expect(https.createServer).not.toHaveBeenCalled();
});

test('creates a public TLS 1.3 server that requests but does not reject certificates at handshake', () => {
  const readFile = jest.fn(path => Buffer.from(path));
  const trp = {
    serverCertPath: '/server.pem',
    serverKeyPath: '/server-key.pem',
    serverCaPath: '/client-ca.pem',
  };

  createPublicTlsServer({ app, config: { protocol: 'TRP', trp }, readFile });

  expect(https.createServer).toHaveBeenCalledWith(
    {
      ca: Buffer.from('/client-ca.pem'),
      cert: Buffer.from('/server.pem'),
      key: Buffer.from('/server-key.pem'),
      maxVersion: 'TLSv1.3',
      minVersion: 'TLSv1.3',
      rejectUnauthorized: false,
      requestCert: true,
    },
    app,
  );
});
