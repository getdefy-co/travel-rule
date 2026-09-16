import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const createHttpServer = app => {
  return http.createServer(app);
};

const createPublicTlsServer = ({ app, config, readFile = fs.readFileSync }) => {
  const options = {
    ca: readFile(config.trp.serverCaPath),
    cert: readFile(config.trp.serverCertPath),
    key: readFile(config.trp.serverKeyPath),
    maxVersion: 'TLSv1.3',
    minVersion: 'TLSv1.3',
    rejectUnauthorized: false,
    requestCert: true,
  };

  return https.createServer(options, app);
};

const createProtocolServer = ({ app, config, readFile = fs.readFileSync }) => {
  if (config.protocol !== 'TRP') {
    return createHttpServer(app);
  }

  return createPublicTlsServer({ app, config, readFile });
};

export { createHttpServer, createProtocolServer, createPublicTlsServer };
