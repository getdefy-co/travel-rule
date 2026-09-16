import { createHash } from 'node:crypto';

const POLICY_PROFILES = Object.freeze({
  'EU-TFR-2024': Object.freeze({ retentionProfile: 'EU-5Y' }),
  'TR-MASAK-2025': Object.freeze({ retentionProfile: 'TR-5Y' }),
});

const stableValue = value => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(item => {
      return stableValue(item);
    });
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        return { ...result, [key]: stableValue(value[key]) };
      }, {});
  }

  return value;
};

const snapshotHash = input => {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(input)))
    .digest('hex');
};

const getValuation = (input, currency) => {
  return (
    input.valuations?.find(valuation => {
      return valuation.currency === currency;
    }) || null
  );
};

const hasText = value => {
  return typeof value === 'string' && value.trim().length > 0;
};

const hasFreshValuation = (input, currency) => {
  const valuation = getValuation(input, currency);
  const asOf = new Date(valuation?.asOf);
  const age = input.now.getTime() - asOf.getTime();

  return (
    valuation &&
    hasText(valuation.source) &&
    typeof valuation.value === 'number' &&
    Number.isFinite(valuation.value) &&
    valuation.value >= 0 &&
    !Number.isNaN(asOf.getTime()) &&
    age >= -60000 &&
    age <= 5 * 60 * 1000
  );
};

const missingCommonFields = parties => {
  const required = [];

  if (!hasText(parties?.originator?.name)) {
    required.push('originator.name');
  }

  if (!hasText(parties?.originator?.account)) {
    required.push('originator.account');
  }

  if (!hasText(parties?.beneficiary?.name)) {
    required.push('beneficiary.name');
  }

  if (!hasText(parties?.beneficiary?.account)) {
    required.push('beneficiary.account');
  }

  return required;
};

const decision = ({ action, approval, input, reasonCodes = [], requiredFields = [], waitUntil = null }) => {
  return {
    action,
    approval,
    profile: input.profile,
    reasonCodes,
    requiredFields,
    retentionProfile: POLICY_PROFILES[input.profile].retentionProfile,
    snapshotHash: snapshotHash(input),
    waitUntil,
  };
};

const sanctionsDecision = input => {
  const sanctionsMatch = input.riskSignals?.some(signal => {
    return signal?.type === 'sanctions' && signal.matched === true;
  });

  if (!sanctionsMatch) {
    return null;
  }

  return decision({ action: 'reject', approval: 'compliance_approver', input, reasonCodes: ['SANCTIONS_MATCH'] });
};

const evaluateTurkishPolicy = input => {
  const requiredFields = missingCommonFields(input.parties);

  if (!hasText(input.description) || input.description.trim().length < 20) {
    requiredFields.push('description');
  }

  if (requiredFields.length > 0) {
    return decision({ action: 'hold', approval: 'compliance_reviewer', input, reasonCodes: ['REQUIRED_DATA_MISSING'], requiredFields });
  }

  const tryValuation = getValuation(input, 'TRY');
  const linkedTry = Number(input.linkedTotals?.tryAmount || 0);

  if (tryValuation && tryValuation.value + linkedTry >= 15000 && (!input.parties.originator.verified || !hasText(input.parties.originator.identifier))) {
    return decision({
      action: 'hold',
      approval: 'compliance_reviewer',
      input,
      reasonCodes: ['ORIGINATOR_VERIFICATION_REQUIRED'],
      requiredFields: ['originator.identifier', 'originator.verified'],
    });
  }

  if (input.asset?.isStablecoin) {
    const usdValuation = getValuation(input, 'USD');
    const dailyLimit = input.travelRuleApplied ? 6000 : 3000;
    const monthlyLimit = input.travelRuleApplied ? 100000 : 50000;
    const dailyTotal = Number(input.linkedTotals?.dailyUsd || 0) + Number(usdValuation?.value || 0);
    const monthlyTotal = Number(input.linkedTotals?.monthlyUsd || 0) + Number(usdValuation?.value || 0);

    if (dailyTotal > dailyLimit || monthlyTotal > monthlyLimit) {
      return decision({ action: 'hold', approval: 'compliance_reviewer', input, reasonCodes: ['STABLECOIN_LIMIT_EXCEEDED'] });
    }
  }

  if (input.counterpartyType === 'unhosted') {
    if (!input.walletEvidence?.declaration || !hasText(input.walletEvidence?.ownerName)) {
      return decision({
        action: 'manual_review',
        approval: 'compliance_approver',
        input,
        reasonCodes: ['UNHOSTED_WALLET_EVIDENCE_REQUIRED'],
        requiredFields: ['walletEvidence.declaration', 'walletEvidence.ownerName'],
      });
    }

    const acquiredAt = new Date(input.assetAcquiredAt);

    if (!Number.isNaN(acquiredAt.getTime())) {
      const waitingHours = input.firstWithdrawal ? 72 : 48;
      const waitUntil = new Date(acquiredAt.getTime() + waitingHours * 60 * 60 * 1000);

      if (waitUntil > input.now) {
        return decision({ action: 'hold', approval: 'compliance_reviewer', input, reasonCodes: ['WAITING_PERIOD_ACTIVE'], waitUntil: waitUntil.toISOString() });
      }
    }
  }

  return decision({ action: 'allow', approval: 'none', input });
};

const evaluateEuropeanPolicy = input => {
  const requiredFields = missingCommonFields(input.parties);
  const originator = input.parties?.originator;

  if (!originator?.verified) {
    requiredFields.push('originator.verified');
  }

  if (!hasText(originator?.address) && !hasText(originator?.identifier)) {
    requiredFields.push('originator.address_or_identifier');
  }

  if (requiredFields.length > 0) {
    return decision({ action: 'hold', approval: 'compliance_reviewer', input, reasonCodes: ['REQUIRED_DATA_MISSING'], requiredFields });
  }

  const eurValuation = getValuation(input, 'EUR');

  if (input.counterpartyType === 'unhosted' && Number(eurValuation?.value || 0) > 1000 && input.walletEvidence?.ownershipControlVerified !== true) {
    return decision({
      action: 'manual_review',
      approval: 'compliance_approver',
      input,
      reasonCodes: ['WALLET_OWNERSHIP_ASSESSMENT_REQUIRED'],
      requiredFields: ['walletEvidence.ownershipControlVerified'],
    });
  }

  return decision({ action: 'allow', approval: 'none', input });
};

const evaluatePolicy = input => {
  if (!POLICY_PROFILES[input?.profile] || !(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw new Error('Invalid policy input.');
  }

  const sanctions = sanctionsDecision(input);

  if (sanctions) {
    return sanctions;
  }

  const requiredValuations = input.profile === 'TR-MASAK-2025' ? ['TRY'] : ['EUR'];

  if (input.profile === 'TR-MASAK-2025' && input.asset?.isStablecoin) {
    requiredValuations.push('USD');
  }

  const missingValuations = requiredValuations.filter(currency => {
    return !hasFreshValuation(input, currency);
  });

  if (missingValuations.length > 0) {
    return decision({
      action: 'hold',
      approval: 'compliance_reviewer',
      input,
      reasonCodes: ['VALUATION_REQUIRED'],
      requiredFields: missingValuations.map(currency => {
        return `valuations.${currency}`;
      }),
    });
  }

  if (input.profile === 'TR-MASAK-2025') {
    return evaluateTurkishPolicy(input);
  }

  return evaluateEuropeanPolicy(input);
};

export { POLICY_PROFILES, evaluatePolicy };
