import { isSensitiveField } from './sanitizer';

const decodeQueryField = field => {
  try {
    return decodeURIComponent(field);
  } catch (_error) {
    return field;
  }
};

const redactQueryValues = value => {
  return value.replace(/([?&])([^=&#]+)=([^&#]*)/g, (match, separator, field) => {
    return isSensitiveField(decodeQueryField(field)) ? `${separator}${field}=[REDACTED]` : match;
  });
};

const redactRequestUrl = value => {
  if (typeof value !== 'string') {
    return '';
  }

  const redactedPath = value
    .replace(/(\/travel-rule\/trp\/protocol\/(?:inquiries|resolutions|confirmations)\/)[^/?#]+/gi, '$1[REDACTED]')
    .replace(/(\/(?:api-?keys?|password|reset|secrets?|tokens?)\/)[^/?#]+/gi, '$1[REDACTED]');

  return redactQueryValues(redactedPath);
};

export { redactRequestUrl };
