const SENSITIVE_SUFFIXES = ['apikey', 'authorization', 'cookie', 'email', 'passphrase', 'password', 'passwordhash', 'privatekey', 'secret', 'token'];

const PII_FIELDS = new Set([
  'accountnumber',
  'address',
  'customeridentification',
  'customernumber',
  'dateofbirth',
  'email',
  'emailaddress',
  'firstname',
  'fullname',
  'geographicaddress',
  'iban',
  'ipaddress',
  'lastname',
  'middlename',
  'mobile',
  'name',
  'nationalidentification',
  'nationalidentifier',
  'naturalpersonname',
  'passport',
  'passportnumber',
  'phonenumber',
  'placeofbirth',
  'postalcode',
  'postcode',
  'primaryidentifier',
  'registrationnumber',
  'remoteaddr',
  'secondaryidentifier',
  'socialsecuritynumber',
  'ssn',
  'streetaddress',
  'taxid',
  'taxidentifier',
  'telephone',
  'useremail',
  'zipcode',
]);

const SENSITIVE_ENVELOPE_FIELDS = new Set(['body', 'query', 'queryparams', 'rawbody', 'requestbody', 'requestquery', 'responsebody', 'searchparams', 'urlsearchparams']);

const normalizeField = field => {
  return field.toLowerCase().replace(/[^a-z0-9]/g, '');
};

const isSensitiveField = field => {
  const normalized = normalizeField(field);
  return (
    PII_FIELDS.has(normalized) ||
    SENSITIVE_ENVELOPE_FIELDS.has(normalized) ||
    SENSITIVE_SUFFIXES.some(suffix => {
      return normalized.endsWith(suffix);
    })
  );
};

const maskValue = _value => {
  return '[REDACTED]';
};

const sanitizeData = (data, seen = new WeakSet()) => {
  if (data === null || data === undefined || typeof data !== 'object') {
    return data;
  }

  if (seen.has(data)) {
    return '[Circular]';
  }

  seen.add(data);

  if (Array.isArray(data)) {
    return data.map(item => {
      return sanitizeData(item, seen);
    });
  }

  const sanitized = {};
  Object.entries(data).forEach(([key, value]) => {
    sanitized[key] = isSensitiveField(key) ? maskValue(value) : sanitizeData(value, seen);
  });
  return sanitized;
};

export { isSensitiveField };
export default { sanitizeData, maskValue };
