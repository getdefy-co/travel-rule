import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const ACCEPTANCE_LOCK_PATH = 'scripts/docs-acceptance-lock.json';
export const ACCEPTANCE_LOCK_VERSION = 1;
export const ACCEPTANCE_LOCK_ALGORITHM = 'sha256';

const ACCEPTANCE_DOCUMENTS = ['README.md', 'docs/manual-trp-testing.md'];
const SHELL_FENCE_PATTERN = /```(?:bash|sh|shell)\s*\n([\s\S]*?)```/g;
const LINKAGE_PATTERN = /^<!-- command-acceptance: ([a-z0-9:-]+) -->$/;
const OPERATION_MARKER_PATTERN = /^\s*# docs-acceptance: ([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/;

export const canonicalAcceptanceSource = source => {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  while (lines[0] === '') {
    lines.shift();
  }

  while (lines.at(-1) === '') {
    lines.pop();
  }

  return lines.join('\n');
};

export const acceptanceSourceDigest = source => {
  return createHash('sha256').update(canonicalAcceptanceSource(source)).digest('hex');
};

const fullFileSourceDigest = sourceBytes => {
  return createHash('sha256').update(sourceBytes).digest('hex');
};

const documentEntries = root => {
  return ACCEPTANCE_DOCUMENTS.flatMap(file => {
    const target = path.join(root, file);

    if (!existsSync(target)) {
      return [];
    }

    const markdown = readFileSync(target, 'utf8');
    const entries = [];
    let match;
    let block = 0;

    SHELL_FENCE_PATTERN.lastIndex = 0;
    while ((match = SHELL_FENCE_PATTERN.exec(markdown)) !== null) {
      block += 1;
      const precedingLine = markdown.slice(0, match.index).trimEnd().split('\n').at(-1) || '';
      const linkage = LINKAGE_PATTERN.exec(precedingLine);

      entries.push({
        file,
        block,
        reference: linkage?.[1] || null,
        sha256: acceptanceSourceDigest(match[1]),
      });
    }

    return entries;
  });
};

const extractMainBody = source => {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex(line => /^main\(\) \{$/.test(line.trim()));

  if (start === -1) {
    return '';
  }

  const body = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '}') {
      return body.join('\n');
    }
    body.push(lines[index]);
  }

  return '';
};

const hasReachableMainInvocation = source => {
  const directInvocation = /(?:^|\n)main "\$@"[ \t]*\n?$/;
  const guardedInvocation = /(?:^|\n)if \[\[ "\$\{BASH_SOURCE\[0\]\}" == "\$0" \]\]; then\n[ \t]+main "\$@"\nfi[ \t]*\n?$/;

  return directInvocation.test(source) || guardedInvocation.test(source);
};

const operationEntries = root => {
  const file = 'scripts/docker-smoke.sh';
  const target = path.join(root, file);

  if (!existsSync(target)) {
    return [];
  }

  const source = readFileSync(target, 'utf8');

  if (!hasReachableMainInvocation(source)) {
    return [];
  }

  const sections = [];
  let current = null;

  const finishSection = () => {
    if (!current) {
      return;
    }

    sections.push({
      file,
      operation: current.operation,
      sha256: acceptanceSourceDigest(current.lines.join('\n')),
    });
  };

  extractMainBody(source)
    .split('\n')
    .forEach(line => {
      const marker = OPERATION_MARKER_PATTERN.exec(line);

      if (marker) {
        finishSection();
        current = { lines: [], operation: marker[1] };
        return;
      }

      if (current) {
        current.lines.push(line);
      }
    });
  finishSection();

  return sections;
};

const dockerSmokeFileEntry = root => {
  const file = 'scripts/docker-smoke.sh';
  const target = path.join(root, file);

  if (!existsSync(target)) {
    return null;
  }

  return {
    file,
    sha256: fullFileSourceDigest(readFileSync(target)),
  };
};

export const collectAcceptanceLockEntries = root => {
  return {
    documents: documentEntries(root),
    dockerOperations: operationEntries(root),
    dockerSmokeFile: dockerSmokeFileEntry(root),
  };
};

const documentKey = entry => {
  return `${entry.file}#${entry.block}`;
};

const operationKey = entry => {
  return `${entry.file}#${entry.operation}`;
};

const labelForDocument = entry => {
  return `${entry.file} block ${entry.block}`;
};

const labelForOperation = entry => {
  return `Docker operation ${entry.operation}`;
};

const indexEntries = (entries, keyFor, labelFor, errors) => {
  const indexed = new Map();

  entries.forEach(entry => {
    const key = keyFor(entry);

    if (indexed.has(key)) {
      errors.push(`duplicate acceptance lock entry for ${labelFor(entry)}`);
      return;
    }

    indexed.set(key, entry);
  });

  return indexed;
};

const compareEntries = ({ actual, locked, keyFor, labelFor, metadata, errors }) => {
  const actualIndex = indexEntries(actual, keyFor, labelFor, errors);
  const lockedIndex = indexEntries(locked, keyFor, labelFor, errors);

  actualIndex.forEach((actualEntry, key) => {
    const lockedEntry = lockedIndex.get(key);

    if (!lockedEntry) {
      errors.push(`missing acceptance lock entry for ${labelFor(actualEntry)}`);
      return;
    }

    if (metadata.some(field => lockedEntry[field] !== actualEntry[field])) {
      errors.push(`acceptance lock metadata mismatch for ${labelFor(actualEntry)}`);
    }

    if (lockedEntry.sha256 !== actualEntry.sha256) {
      errors.push(`acceptance lock mismatch for ${labelFor(actualEntry)}`);
    }
  });

  lockedIndex.forEach((lockedEntry, key) => {
    if (!actualIndex.has(key)) {
      errors.push(`extra acceptance lock entry for ${labelFor(lockedEntry)}`);
    }
  });
};

const validDigest = value => {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
};

const validateManifestShape = (manifest, errors) => {
  let valid = true;

  if (manifest?.version !== ACCEPTANCE_LOCK_VERSION) {
    errors.push(`acceptance lock version must be ${ACCEPTANCE_LOCK_VERSION}`);
    valid = false;
  }

  if (manifest?.algorithm !== ACCEPTANCE_LOCK_ALGORITHM) {
    errors.push(`acceptance lock algorithm must be ${ACCEPTANCE_LOCK_ALGORITHM}`);
    valid = false;
  }

  if (!Array.isArray(manifest?.documents) || !Array.isArray(manifest?.dockerOperations)) {
    errors.push('acceptance lock must contain document and Docker operation arrays');
    return false;
  }

  manifest.documents.forEach(entry => {
    if (typeof entry?.file !== 'string' || !Number.isInteger(entry?.block) || typeof entry?.reference !== 'string' || !validDigest(entry?.sha256)) {
      errors.push('acceptance lock contains an invalid document entry');
      valid = false;
    }
  });

  manifest.dockerOperations.forEach(entry => {
    if (entry?.file !== 'scripts/docker-smoke.sh' || typeof entry?.operation !== 'string' || !validDigest(entry?.sha256)) {
      errors.push('acceptance lock contains an invalid Docker operation entry');
      valid = false;
    }
  });

  if (manifest?.dockerSmokeFile === undefined) {
    errors.push('acceptance lock must contain Docker smoke full-source entry');
    valid = false;
  } else {
    const entry = manifest.dockerSmokeFile;
    const fields = entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.keys(entry).sort() : [];

    if (fields.some((field, index) => field !== ['file', 'sha256'][index]) || fields.length !== 2) {
      errors.push('Docker smoke full-source entry has unexpected fields');
      valid = false;
    }

    if (entry?.file !== 'scripts/docker-smoke.sh' || !validDigest(entry?.sha256)) {
      errors.push('acceptance lock contains an invalid Docker smoke full-source entry');
      valid = false;
    }
  }

  return valid;
};

export const buildAcceptanceLock = root => {
  const entries = collectAcceptanceLockEntries(root);
  const errors = [];

  indexEntries(entries.documents, documentKey, labelForDocument, errors);
  indexEntries(entries.dockerOperations, operationKey, labelForOperation, errors);

  entries.documents.forEach(entry => {
    if (!entry.reference) {
      errors.push(`cannot lock ${labelForDocument(entry)} without command-acceptance metadata`);
    }
  });

  if (!entries.dockerSmokeFile) {
    errors.push('cannot lock missing scripts/docker-smoke.sh full source');
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  return {
    version: ACCEPTANCE_LOCK_VERSION,
    algorithm: ACCEPTANCE_LOCK_ALGORITHM,
    generatedBy: 'npm run update:docs-acceptance-lock',
    documents: entries.documents,
    dockerOperations: entries.dockerOperations,
    dockerSmokeFile: entries.dockerSmokeFile,
  };
};

export const validateAcceptanceLock = root => {
  const actual = collectAcceptanceLockEntries(root);
  const lockPath = path.join(root, ACCEPTANCE_LOCK_PATH);
  const errors = [];

  if (actual.documents.length === 0 && actual.dockerOperations.length === 0 && !actual.dockerSmokeFile && !existsSync(lockPath)) {
    return errors;
  }

  if (!existsSync(lockPath)) {
    return [`${ACCEPTANCE_LOCK_PATH}: acceptance lock file is required`];
  }

  let manifest;

  try {
    manifest = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (error) {
    return [`${ACCEPTANCE_LOCK_PATH}: invalid JSON: ${error.message}`];
  }

  if (!validateManifestShape(manifest, errors)) {
    return errors;
  }

  if (!actual.dockerSmokeFile) {
    errors.push('extra acceptance lock entry for Docker smoke full source');
  } else if (manifest.dockerSmokeFile.sha256 !== actual.dockerSmokeFile.sha256) {
    errors.push('acceptance lock mismatch for Docker smoke full source');
  }

  compareEntries({
    actual: actual.documents,
    locked: manifest.documents,
    keyFor: documentKey,
    labelFor: labelForDocument,
    metadata: ['file', 'block', 'reference'],
    errors,
  });
  compareEntries({
    actual: actual.dockerOperations,
    locked: manifest.dockerOperations,
    keyFor: operationKey,
    labelFor: labelForOperation,
    metadata: ['file', 'operation'],
    errors,
  });

  return errors;
};
