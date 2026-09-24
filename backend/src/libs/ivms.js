import { PayloadVersionCode, ensureVersion, validate } from 'ivms101';

const validateVersion = (payload, version) => {
  try {
    return validate(payload, { version });
  } catch (error) {
    throw new Error(`Invalid IVMS 101.${version} payload.`);
  }
};

const preserveAccountNumbers = (converted, source) => {
  const originatorAccountNumbers = source.originator?.accountNumber;
  const beneficiaryAccountNumbers = source.beneficiary?.accountNumber;

  return {
    ...converted,
    originator: {
      ...converted.originator,
      ...(originatorAccountNumbers === undefined ? {} : { accountNumber: originatorAccountNumbers }),
    },
    beneficiary: {
      ...converted.beneficiary,
      ...(beneficiaryAccountNumbers === undefined ? {} : { accountNumber: beneficiaryAccountNumbers }),
    },
  };
};

const toCanonicalIvms = payload => {
  const version = payload?.payloadMetadata?.payloadVersion === PayloadVersionCode.V2023 ? '2023' : '2020';
  const validated = validateVersion(payload, version);
  const canonical = preserveAccountNumbers(ensureVersion(PayloadVersionCode.V2023, validated), validated);

  return validateVersion(canonical, '2023');
};

const fromCanonicalIvms = payload => {
  const canonical = validateVersion(payload, '2023');
  const wire = preserveAccountNumbers(ensureVersion(PayloadVersionCode.V2020, canonical), canonical);

  return validateVersion(wire, '2020');
};

export { fromCanonicalIvms, toCanonicalIvms };
