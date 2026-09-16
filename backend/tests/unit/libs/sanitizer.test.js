import sanitizer from '../../../src/libs/sanitizer';

describe('sanitizer', () => {
  test.each([
    ['abcdef', '[REDACTED]'],
    ['a', '[REDACTED]'],
    ['', '[REDACTED]'],
    [42, '[REDACTED]'],
  ])('fully redacts a sensitive value', (value, expected) => {
    expect(sanitizer.maskValue(value)).toBe(expected);
  });

  test('recursively redacts case-insensitive secrets and PII in arrays without mutating input', () => {
    const input = {
      user: {
        Email: 'owner@example.test',
        Password: 'secret',
        profile: ['safe', { client_secret: 'abcdef', phoneNumber: '+90 555 000 00 00' }],
      },
      authorization: null,
    };
    input.self = input;

    expect(sanitizer.sanitizeData(input)).toEqual({
      user: {
        Email: '[REDACTED]',
        Password: '[REDACTED]',
        profile: ['safe', { client_secret: '[REDACTED]', phoneNumber: '[REDACTED]' }],
      },
      authorization: '[REDACTED]',
      self: '[Circular]',
    });
    expect(input.user.Password).toBe('secret');
  });

  test.each([null, undefined, 'text', 7])('returns non-object input unchanged', value => {
    expect(sanitizer.sanitizeData(value)).toBe(value);
  });

  test('normalizes common secret and identity field spellings before redaction', () => {
    expect(
      sanitizer.sanitizeData({
        api_key: 'service-key',
        billingEmail: 'billing@example.test',
        contactEmail: 'contact@example.test',
        requestBody: { safeLookingKey: 'body-value' },
        search_params: { page: 'query-value' },
        sender_email: 'sender@example.test',
        passwordHash: 'bcrypt-hash',
        refreshToken: 'refresh-token',
        tax_id: 'tax-identifier',
      }),
    ).toEqual({
      api_key: '[REDACTED]',
      billingEmail: '[REDACTED]',
      contactEmail: '[REDACTED]',
      requestBody: '[REDACTED]',
      search_params: '[REDACTED]',
      sender_email: '[REDACTED]',
      passwordHash: '[REDACTED]',
      refreshToken: '[REDACTED]',
      tax_id: '[REDACTED]',
    });
  });

  test('redacts normalized identity categories while preserving operational metadata', () => {
    expect(
      sanitizer.sanitizeData({
        functionName: 'auth/reset',
        identity: {
          customerNumber: 'customer-123',
          passportNumber: 'passport-456',
          ssn: '111-22-3333',
        },
        requestIdentifier: 'request-789',
        retryCount: 2,
        role: 'admin',
      }),
    ).toEqual({
      functionName: 'auth/reset',
      identity: {
        customerNumber: '[REDACTED]',
        passportNumber: '[REDACTED]',
        ssn: '[REDACTED]',
      },
      requestIdentifier: 'request-789',
      retryCount: 2,
      role: 'admin',
    });
  });
});
