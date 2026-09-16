import fs from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { travelRuleDB } from '@database';
import { isPositiveIntegerAmount } from '@libs/amount';
import { decryptJson, encryptJson } from '@libs/trpEncryption';
import { fromCanonicalIvms, toCanonicalIvms } from '@libs/ivms';
import { decodeTravelAddress, encodeTravelAddress } from '@libs/travelAddress';
import { postJson, validateHttpsTarget } from '@libs/safeHttps';

const API_VERSION = '3.2.1';

const createToken = ({ transferId, purpose, ttlSeconds }) => {
  const value = randomBytes(32).toString('base64url');

  return {
    digest: createHash('sha256').update(value, 'utf8').digest(),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    id: randomUUID(),
    purpose,
    transferId,
    value,
  };
};

const digestToken = value => {
  return createHash('sha256').update(value, 'utf8').digest();
};

const publicTransfer = transfer => {
  return {
    amount: transfer.amount,
    asset: transfer.asset_dti ? { dti: transfer.asset_dti } : null,
    created_at: transfer.created_at,
    direction: transfer.direction,
    expires_at: transfer.expires_at,
    id: transfer.id,
    protocol: transfer.protocol,
    state: transfer.state,
    updated_at: transfer.updated_at,
  };
};

const hasValidProtocolResponseHeaders = (response, requestIdentifier) => {
  return response.headers?.['api-version'] === API_VERSION && response.headers?.['request-identifier'] === requestIdentifier;
};

const invalidProtocolResponse = () => {
  const error = new Error('Invalid TRP peer response.');
  error.code = 'INVALID_PROTOCOL_RESPONSE';
  return error;
};

const classifyInquiryResponse = body => {
  const hasApproved = Object.prototype.hasOwnProperty.call(body || {}, 'approved');
  const hasRejected = Object.prototype.hasOwnProperty.call(body || {}, 'rejected');
  const hasVersion = Object.prototype.hasOwnProperty.call(body || {}, 'version');

  if (Number(hasApproved) + Number(hasRejected) + Number(hasVersion) !== 1) {
    throw invalidProtocolResponse();
  }

  if (hasApproved) {
    if (typeof body.approved?.address !== 'string' || !body.approved.address || typeof body.approved?.callback !== 'string') {
      throw invalidProtocolResponse();
    }

    try {
      validateHttpsTarget(body.approved.callback);
    } catch {
      throw invalidProtocolResponse();
    }

    return { kind: 'approved', value: body.approved };
  }

  if (hasRejected) {
    if (body.rejected !== null && typeof body.rejected !== 'string') {
      throw invalidProtocolResponse();
    }

    return { kind: 'rejected', value: body.rejected };
  }

  if (body.version !== API_VERSION) {
    throw invalidProtocolResponse();
  }

  return { kind: 'pending' };
};

const validateDeliveryResponse = ({ phase, requestIdentifier, response }) => {
  const expectedStatus = phase === 'inquiry' ? 200 : 204;

  if (response.statusCode !== expectedStatus || !hasValidProtocolResponseHeaders(response, requestIdentifier)) {
    throw invalidProtocolResponse();
  }

  return phase === 'inquiry' ? classifyInquiryResponse(response.body) : null;
};

const createTravelRuleService = ({ config, database = travelRuleDB, readFile = fs.readFileSync, send = postJson } = {}) => {
  const encryptionKey = config.encryptionKeyring || config.encryptionKey;
  const outboundTls = {
    ca: readFile(config.clientCaPath),
    cert: readFile(config.clientCertPath),
    key: readFile(config.clientKeyPath),
  };
  const retentionUntil = () => {
    return new Date(Date.now() + config.retentionDays * 24 * 60 * 60 * 1000);
  };
  const encrypt = value => {
    return encryptJson(value, encryptionKey);
  };
  const decrypt = value => {
    return decryptJson(value, encryptionKey);
  };
  const serviceTransfer = transfer => {
    return {
      ...publicTransfer(transfer),
      operation: transfer.operation_encrypted ? decrypt(transfer.operation_encrypted) : null,
    };
  };
  const createOutboundMessage = ({ transferId, phase, logicalIdentifier = randomUUID(), requestIdentifier = randomUUID(), url, body }) => {
    validateHttpsTarget(url);
    return {
      deliveryState: 'pending',
      direction: 'outbound',
      id: randomUUID(),
      logicalIdentifier,
      phase,
      requestEncrypted: encrypt({ body, url }),
      requestIdentifier,
      transferId,
    };
  };
  const inquiryTransition = ({ classification, transferId }) => {
    if (classification.kind === 'approved') {
      return {
        eventType: 'inquiry_approved',
        expectedStates: ['pending'],
        operationEncrypted: encrypt({ confirmationUrl: classification.value.callback, paymentAddress: classification.value.address }),
        state: 'approved',
        transferId,
      };
    }

    if (classification.kind === 'rejected') {
      return {
        eventType: 'inquiry_rejected',
        expectedStates: ['pending'],
        operationEncrypted: encrypt({ reason: classification.value }),
        state: 'rejected',
        transferId,
      };
    }

    return null;
  };

  const recordDelivery = async ({ transferId, phase, url, body, message: preparedMessage = null, transition = null }) => {
    const message = preparedMessage || createOutboundMessage({ body, phase, transferId, url });

    if (!preparedMessage) {
      await database.insertMessage(message);
    }

    try {
      const response = await send({
        body,
        headers: { 'api-version': API_VERSION, 'request-identifier': message.requestIdentifier },
        timeoutMs: config.httpTimeoutMs,
        tls: outboundTls,
        url,
      });

      const classification = validateDeliveryResponse({ phase, requestIdentifier: message.requestIdentifier, response });

      const responseEncrypted = response.body === null ? null : encrypt(response.body);
      const applied = await database.completeOutboundDelivery({
        id: message.id,
        responseEncrypted,
        statusCode: response.statusCode,
        transition: transition ? transition(classification) : null,
      });

      if (!applied) {
        throw new Error('TRP delivery could not be applied.');
      }

      return { classification, delivered: true, message, response };
    } catch (error) {
      const errorCode = error.code === 'INVALID_PROTOCOL_RESPONSE' ? error.code : 'DELIVERY_FAILED';
      await database.updateMessageDelivery({ id: message.id, errorCode, state: 'failed' });
      return { delivered: false, error: 'DELIVERY_FAILED', message };
    }
  };

  const createTravelAddress = async ({ beneficiaryReference, ttlSeconds }) => {
    const transferId = randomUUID();
    const token = createToken({ purpose: 'inquiry', transferId, ttlSeconds: ttlSeconds || config.tokenTtlSeconds });
    const expiresAt = token.expiresAt;
    const url = `${config.publicBaseUrl}/travel-rule/trp/protocol/inquiries/${token.value}?t=i`;
    const travelAddress = encodeTravelAddress(url.slice('https://'.length));

    await database.createTransfer({
      eventType: 'travel_address_created',
      token,
      transfer: {
        direction: 'inbound',
        expiresAt,
        id: transferId,
        payloadEncrypted: encrypt({ beneficiaryReference }),
        retentionUntil: retentionUntil(),
        state: 'pending',
      },
    });
    return { expires_at: expiresAt, id: transferId, travel_address: travelAddress };
  };

  const createOutboundTransfer = async ({ travelAddress, asset, amount, ivms101, idempotencyId = null }) => {
    if (idempotencyId) {
      const existing = await database.getTransfer(idempotencyId);

      if (existing) {
        return { httpStatus: 200, result: serviceTransfer(existing) };
      }
    }

    const decoded = decodeTravelAddress(travelAddress);
    const remoteUrl = `https://${decoded}`;
    validateHttpsTarget(remoteUrl);
    const canonical = toCanonicalIvms(ivms101);
    const transferId = idempotencyId || randomUUID();
    const resolutionToken = createToken({ purpose: 'resolution', transferId, ttlSeconds: config.tokenTtlSeconds });
    const body = {
      IVMS101: fromCanonicalIvms(canonical),
      amount,
      asset: { dti: asset.dti },
      callback: `${config.publicBaseUrl}/travel-rule/trp/protocol/resolutions/${resolutionToken.value}`,
    };
    const message = createOutboundMessage({ body, phase: 'inquiry', transferId, url: remoteUrl });

    await database.createTransfer({
      eventType: 'outbound_transfer_created',
      message,
      token: resolutionToken,
      transfer: {
        amount: String(amount),
        assetDti: asset.dti,
        direction: 'outbound',
        expiresAt: resolutionToken.expiresAt,
        id: transferId,
        payloadEncrypted: encrypt({ ivms101: canonical, remoteUrl, travelAddress }),
        retentionUntil: retentionUntil(),
        state: 'pending',
      },
    });
    const delivery = await recordDelivery({
      body,
      message,
      phase: 'inquiry',
      transferId,
      transition: classification => {
        return inquiryTransition({ classification, transferId });
      },
      url: remoteUrl,
    });

    if (!delivery.delivered) {
      return { httpStatus: 202, result: { id: transferId, retryable: true, state: 'pending' } };
    }

    const transfer = await database.getTransfer(transferId);
    return { httpStatus: 200, result: serviceTransfer(transfer) };
  };

  const receiveInquiry = async ({ token, peerFingerprint, requestIdentifier, body }) => {
    if (
      typeof body !== 'object' ||
      !body ||
      typeof body.IVMS101 !== 'object' ||
      !body.IVMS101 ||
      typeof body.asset?.dti !== 'string' ||
      !body.asset.dti ||
      !isPositiveIntegerAmount(body.amount) ||
      typeof body.callback !== 'string'
    ) {
      throw new Error('Invalid inquiry payload.');
    }

    const canonical = toCanonicalIvms(body.IVMS101);
    validateHttpsTarget(body.callback);
    const response = { version: API_VERSION };
    return database.consumeProtocolToken({
      peerFingerprint,
      purpose: 'inquiry',
      requestIdentifier,
      responseEncrypted: encrypt(response),
      tokenDigest: digestToken(token),
      transition: {
        allowedStates: ['pending'],
        amount: String(body.amount),
        assetDti: body.asset.dti,
        eventType: 'inquiry_received',
        logicalIdentifier: randomUUID(),
        messageId: randomUUID(),
        nextState: 'pending',
        payloadEncrypted: encrypt({ callback: body.callback, ivms101: canonical }),
        requestEncrypted: encrypt(body),
        statusCode: 200,
      },
    });
  };

  const receiveResolution = async ({ token, peerFingerprint, requestIdentifier, body }) => {
    const approved = body?.approved;
    const hasApproved = Object.prototype.hasOwnProperty.call(body || {}, 'approved');
    const rejected = Object.prototype.hasOwnProperty.call(body || {}, 'rejected');
    const validApproval = typeof approved?.address === 'string' && approved.address.length > 0 && typeof approved?.callback === 'string';
    const validRejection = body?.rejected === null || typeof body?.rejected === 'string';

    if (hasApproved === rejected || (hasApproved && !validApproval) || (rejected && !validRejection)) {
      throw new Error('Invalid resolution payload.');
    }

    if (approved) {
      validateHttpsTarget(approved.callback);
    }

    return database.consumeProtocolToken({
      peerFingerprint,
      purpose: 'resolution',
      requestIdentifier,
      responseEncrypted: encrypt(null),
      tokenDigest: digestToken(token),
      transition: {
        allowedStates: ['pending'],
        eventType: approved ? 'inquiry_approved' : 'inquiry_rejected',
        logicalIdentifier: randomUUID(),
        messageId: randomUUID(),
        nextState: approved ? 'approved' : 'rejected',
        operationEncrypted: encrypt(approved ? { confirmationUrl: approved.callback, paymentAddress: approved.address } : { reason: body.rejected }),
        requestEncrypted: encrypt(body),
        statusCode: 204,
      },
    });
  };

  const receiveConfirmation = async ({ token, peerFingerprint, requestIdentifier, body }) => {
    const hasTxid = typeof body?.txid === 'string' && body.txid.length > 0;
    const hasCanceled = Object.prototype.hasOwnProperty.call(body || {}, 'canceled');
    const validCanceled = body?.canceled === null || typeof body?.canceled === 'string';

    if (hasTxid === hasCanceled || (hasCanceled && !validCanceled)) {
      throw new Error('Invalid confirmation payload.');
    }

    const tokenDigest = digestToken(token);
    const current = await database.getTransferByTokenDigest({ digest: tokenDigest, purpose: 'confirmation' });
    const operation = current?.operation_encrypted ? decrypt(current.operation_encrypted) : {};

    return database.consumeProtocolToken({
      peerFingerprint,
      purpose: 'confirmation',
      requestIdentifier,
      responseEncrypted: encrypt(null),
      tokenDigest,
      transition: {
        allowedStates: ['approved'],
        eventType: hasTxid ? 'transfer_confirmed' : 'transfer_canceled',
        logicalIdentifier: randomUUID(),
        messageId: randomUUID(),
        nextState: hasTxid ? 'confirmed' : 'canceled',
        operationEncrypted: encrypt(hasTxid ? { ...operation, txid: body.txid } : { ...operation, canceled: body.canceled }),
        requestEncrypted: encrypt(body),
        statusCode: 204,
      },
    });
  };

  const listInquiries = async ({ status, search = '', page, limit }) => {
    const result = await database.listInquiries({ limit, offset: (page - 1) * limit, search, status });
    return { ...result, page, limit };
  };

  const getInquiry = async id => {
    const transfer = await database.getTransfer(id);

    if (!transfer || transfer.direction !== 'inbound') {
      return null;
    }

    const payload = decrypt(transfer.payload_encrypted);
    return { ...publicTransfer(transfer), ivms101: payload.ivms101 || null };
  };

  const getTransfer = async id => {
    const transfer = await database.getTransfer(id);
    return transfer ? serviceTransfer(transfer) : null;
  };

  const decideInquiry = async ({ id, decision, paymentAddress, reason, actor }) => {
    const current = await database.getTransfer(id);

    if (!current || current.direction !== 'inbound' || current.state !== 'pending') {
      return null;
    }

    const payload = decrypt(current.payload_encrypted);
    const confirmationToken = decision === 'approved' ? createToken({ purpose: 'confirmation', transferId: id, ttlSeconds: config.tokenTtlSeconds }) : null;
    const responseBody =
      decision === 'approved'
        ? { approved: { address: paymentAddress, callback: `${config.publicBaseUrl}/travel-rule/trp/protocol/confirmations/${confirmationToken.value}` } }
        : { rejected: reason || null };
    const message = createOutboundMessage({ body: responseBody, phase: 'resolution', transferId: id, url: payload.callback });
    const updated = await database.decideInquiry({
      actor: { emailEncrypted: encrypt(actor.email), role: actor.role, userId: actor.userId },
      eventType: decision === 'approved' ? 'manual_approval' : 'manual_rejection',
      expectedState: 'pending',
      id,
      message,
      nextState: decision,
      operationEncrypted: encrypt(decision === 'approved' ? { paymentAddress } : { reason: reason || null }),
      token: confirmationToken,
    });

    if (!updated) {
      return null;
    }

    const delivery = await recordDelivery({ body: responseBody, message, phase: 'resolution', transferId: id, url: payload.callback });
    return {
      httpStatus: delivery.delivered ? 200 : 202,
      result: { id, retryable: !delivery.delivered, state: decision },
    };
  };

  const confirmTransfer = async ({ id, txid, canceled }) => {
    const current = await database.getTransfer(id);

    if (!current || current.direction !== 'outbound' || current.state !== 'approved') {
      return null;
    }

    const operation = decrypt(current.operation_encrypted);
    const body = txid ? { txid } : { canceled };
    const message = createOutboundMessage({ body, phase: 'confirmation', transferId: id, url: operation.confirmationUrl });
    const reserved = await database.reserveOutboundMessage({ expectedDirection: 'outbound', expectedStates: ['approved'], message });

    if (!reserved) {
      return null;
    }

    const delivery = await recordDelivery({
      body,
      message,
      phase: 'confirmation',
      transferId: id,
      transition: () => {
        return {
          eventType: txid ? 'transfer_confirmed' : 'transfer_canceled',
          expectedStates: ['approved'],
          operationEncrypted: encrypt({ ...operation, ...body }),
          state: txid ? 'confirmed' : 'canceled',
          transferId: id,
        };
      },
      url: operation.confirmationUrl,
    });

    return { httpStatus: delivery.delivered ? 200 : 202, result: { id, retryable: !delivery.delivered, state: delivery.delivered ? (txid ? 'confirmed' : 'canceled') : 'approved' } };
  };

  const retryTransfer = async id => {
    const staleBefore = new Date(Date.now() - config.httpTimeoutMs * 2);
    const previous = await database.getRetryableMessage(id, staleBefore);

    if (!previous) {
      return null;
    }

    const request = decrypt(previous.request_encrypted);
    const message = {
      id: randomUUID(),
      logicalIdentifier: previous.logical_identifier,
      phase: previous.phase,
      requestEncrypted: previous.request_encrypted,
      requestIdentifier: previous.request_identifier,
      transferId: id,
    };

    const reserved = await database.supersedeMessage({ message, previousId: previous.id });

    if (!reserved) {
      return null;
    }

    try {
      const response = await send({
        body: request.body,
        headers: { 'api-version': API_VERSION, 'request-identifier': message.requestIdentifier },
        timeoutMs: config.httpTimeoutMs,
        tls: outboundTls,
        url: request.url,
      });
      const classification = validateDeliveryResponse({ phase: message.phase, requestIdentifier: message.requestIdentifier, response });
      let transition = null;

      if (message.phase === 'inquiry') {
        transition = inquiryTransition({ classification, transferId: id });
      } else if (message.phase === 'confirmation') {
        const transfer = await database.getTransfer(id);
        const operation = decrypt(transfer.operation_encrypted);

        transition = {
          eventType: request.body.txid ? 'transfer_confirmed' : 'transfer_canceled',
          expectedStates: ['approved'],
          operationEncrypted: encrypt({ ...operation, ...request.body }),
          state: request.body.txid ? 'confirmed' : 'canceled',
          transferId: id,
        };
      }

      const applied = await database.completeOutboundDelivery({
        id: message.id,
        responseEncrypted: response.body ? encrypt(response.body) : null,
        statusCode: response.statusCode,
        transition,
      });

      if (!applied) {
        throw new Error('TRP delivery could not be applied.');
      }

      return { httpStatus: 200, result: { id, retryable: false } };
    } catch (error) {
      const errorCode = error.code === 'INVALID_PROTOCOL_RESPONSE' ? error.code : 'DELIVERY_FAILED';
      await database.updateMessageDelivery({ id: message.id, errorCode, state: 'failed' });
      return { httpStatus: 202, result: { id, retryable: true } };
    }
  };

  return {
    cleanup: () => {
      return database.cleanupExpired(config.retentionDays);
    },
    confirmTransfer,
    createOutboundTransfer,
    getRetryBefore: () => {
      return new Date(Date.now() - config.httpTimeoutMs * 2);
    },
    createTravelAddress,
    decideInquiry,
    getInquiry,
    getTransfer,
    identity: { lei: config.lei, name: config.name, x509: readFile(config.clientCertPath, 'utf8').toString() },
    listInquiries,
    receiveConfirmation,
    receiveInquiry,
    receiveResolution,
    retryTransfer,
  };
};

export { API_VERSION, createTravelRuleService, digestToken };
