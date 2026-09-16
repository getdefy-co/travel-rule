#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ACCEPTANCE_LOCK_PATH, buildAcceptanceLock } from './docs-acceptance-lock.mjs';

const parseRoot = arguments_ => {
  if (arguments_.length === 0) {
    return process.cwd();
  }

  if (arguments_.length === 2 && arguments_[0] === '--root') {
    return path.resolve(arguments_[1]);
  }

  throw new Error('usage: generate-docs-acceptance-lock.mjs [--root PATH]');
};

const root = parseRoot(process.argv.slice(2));
const destination = path.join(root, ACCEPTANCE_LOCK_PATH);
const manifest = buildAcceptanceLock(root);

writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Updated ${ACCEPTANCE_LOCK_PATH}; review the manifest diff before committing.\n`);
