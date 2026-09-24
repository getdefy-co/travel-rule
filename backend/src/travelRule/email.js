import { createHash, randomBytes as cryptoRandomBytes, randomUUID as cryptoRandomUUID } from 'node:crypto';
import validator from 'validator';
import { decryptJson, encryptJson } from '@libs/trpEncryption';

const MAGIC_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const serviceError = (message, statusCode) => {
  const error = new Error(message);

  error.statusCode = statusCode;
  return error;
};

const normalizeRecipientEmail = value => {
  if (typeof value !== 'string') {
    throw serviceError('Invalid recipient email.', 400);
  }

  const trimmed = value.trim();
  const separator = trimmed.lastIndexOf('@');
  const normalized = separator > 0 ? `${trimmed.slice(0, separator)}@${trimmed.slice(separator + 1).toLowerCase()}` : trimmed;

  if (normalized.length > 254 || /[\r\n]/.test(normalized) || !validator.isEmail(normalized)) {
    throw serviceError('Invalid recipient email.', 400);
  }

  return normalized;
};

const publicJob = (job, decrypt) => {
  return {
    attempts: job.attempts,
    consumed_at: job.consumedAt,
    created_at: job.createdAt,
    expires_at: job.expiresAt,
    id: job.id,
    last_error_code: job.lastErrorCode,
    recipient_email: decrypt(job.recipientEmailEncrypted),
    sent_at: job.sentAt,
    status: job.status,
    transfer_id: job.transferId,
    updated_at: job.updatedAt,
  };
};

const addressesFor = person => {
  return (person?.geographicAddress || []).map(address => {
    return {
      country: address.country || null,
      lines: Array.isArray(address.addressLine) ? address.addressLine : [],
      town: address.townName || null,
    };
  });
};

const naturalName = person => {
  const identifier = person?.name?.nameIdentifier?.[0] || {};

  return [identifier.secondaryIdentifier, identifier.primaryIdentifier].filter(Boolean).join(' ');
};

const legalName = person => {
  return person?.name?.nameIdentifier?.[0]?.legalPersonName || '';
};

const summarizePersons = ({ accounts, people }) => {
  return (people || []).map(wrapper => {
    if (wrapper.naturalPerson) {
      return {
        accounts,
        addresses: addressesFor(wrapper.naturalPerson),
        country: wrapper.naturalPerson.countryOfResidence || null,
        name: naturalName(wrapper.naturalPerson),
        type: 'natural',
      };
    }

    return {
      accounts,
      addresses: addressesFor(wrapper.legalPerson),
      country: wrapper.legalPerson?.countryOfRegistration || null,
      name: legalName(wrapper.legalPerson),
      type: 'legal',
    };
  });
};

const summarizeTransfer = (transfer, decrypt) => {
  const payload = decrypt(transfer.payload_encrypted);
  const ivms101 = payload.ivms101 || {};
  const originator = ivms101.originator || {};
  const beneficiary = ivms101.beneficiary || {};

  return {
    beneficiaries: summarizePersons({ accounts: beneficiary.accountNumber || [], people: beneficiary.beneficiaryPersons }),
    originators: summarizePersons({ accounts: originator.accountNumber || [], people: originator.originatorPersons }),
    transfer: {
      amount: transfer.amount,
      asset: transfer.asset_dti ? { dti: transfer.asset_dti } : null,
      created_at: transfer.created_at,
      direction: transfer.direction,
      expires_at: transfer.expires_at,
      id: transfer.id,
      protocol: transfer.protocol,
      state: transfer.state,
    },
  };
};

const createTravelRuleEmailService = ({
  config,
  database,
  keyring,
  mailer,
  now = () => {
    return new Date();
  },
  randomBytes = cryptoRandomBytes,
  randomUUID = cryptoRandomUUID,
}) => {
  const encrypt = value => {
    return encryptJson(value, keyring);
  };
  const decrypt = value => {
    return decryptJson(value, keyring);
  };
  const assertEnabled = () => {
    if (!mailer.isEnabled()) {
      throw serviceError('Email delivery is unavailable.', 503);
    }
  };

  const createInvitation = async ({ actorUserId, recipientEmail, transferId }) => {
    assertEnabled();
    const normalizedEmail = normalizeRecipientEmail(recipientEmail);
    const token = randomBytes(32).toString('base64url');
    const created = await database.createJob({
      createdByUserId: actorUserId,
      delayMinutes: config.emailFallbackDelayMinutes,
      expiresAt: new Date(now().getTime() + MAGIC_LINK_TTL_MS),
      id: randomUUID(),
      recipientEmailEncrypted: encrypt(normalizedEmail),
      tokenDigest: createHash('sha256').update(token, 'utf8').digest(),
      tokenEncrypted: encrypt(token),
      transferId,
    });

    if (!created) {
      throw serviceError('Transfer is not eligible for email fallback.', 409);
    }

    return publicJob(created, decrypt);
  };

  const listJobs = async filters => {
    const result = await database.listJobs(filters);

    return {
      ...result,
      data: result.data.map(item => {
        return publicJob(item, decrypt);
      }),
    };
  };

  const retryJob = async id => {
    assertEnabled();
    const retried = await database.retryJob({ delayMinutes: config.emailFallbackDelayMinutes, id });

    if (!retried) {
      throw serviceError('Email job is not eligible for retry.', 409);
    }

    return publicJob(retried, decrypt);
  };

  const consumeToken = async token => {
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) {
      return null;
    }

    const transfer = await database.consumeToken(createHash('sha256').update(token, 'utf8').digest());
    return transfer ? summarizeTransfer(transfer, decrypt) : null;
  };

  const decorateTransfer = transfer => {
    const emailEnabled = mailer.isEnabled();
    const availableAt = transfer.direction === 'outbound' ? new Date(new Date(transfer.created_at).getTime() + config.emailFallbackDelayMinutes * 60 * 1000) : null;
    const currentTime = now().getTime();
    const canEmail =
      emailEnabled &&
      availableAt &&
      availableAt.getTime() <= currentTime &&
      ['pending', 'approved', 'rejected'].includes(transfer.state) &&
      (!transfer.expires_at || new Date(transfer.expires_at).getTime() > currentTime);

    return {
      ...transfer,
      actions: { ...transfer.actions, can_email: Boolean(canEmail) },
      email_enabled: emailEnabled,
      email_fallback_available_at: availableAt ? availableAt.toISOString() : null,
    };
  };

  return Object.freeze({ consumeToken, createInvitation, decorateTransfer, listJobs, retryJob });
};

const createTravelRuleEmailWorker = ({
  database,
  keyring,
  mailer,
  now = () => {
    return new Date();
  },
  random = Math.random,
}) => {
  const processBatch = async () => {
    if (!mailer.isEnabled()) {
      return { claimed: 0, failed: 0, sent: 0 };
    }

    const jobs = await database.claimBatch(10);
    let failed = 0;
    let sent = 0;

    await jobs.reduce(async (previous, job) => {
      await previous;

      try {
        await mailer.sendTravelRuleAccessEmail({
          email: decryptJson(job.recipientEmailEncrypted, keyring),
          token: decryptJson(job.tokenEncrypted, keyring),
        });
        await database.markSent(job.id);
        sent += 1;
      } catch (_error) {
        const backoffSeconds = Math.min(300, 2 ** Math.max(0, job.attempts - 1));
        const jitterMs = Math.floor(random() * 1000);

        await database.markFailed({ attempts: job.attempts, id: job.id, nextAttemptAt: new Date(now().getTime() + backoffSeconds * 1000 + jitterMs) });
        failed += 1;
      }
    }, Promise.resolve());

    return { claimed: jobs.length, failed, sent };
  };

  return Object.freeze({ processBatch });
};

export { createTravelRuleEmailService, createTravelRuleEmailWorker, normalizeRecipientEmail, summarizeTransfer };
