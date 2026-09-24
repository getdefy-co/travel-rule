import { redactRequestUrl } from '../../../src/libs/requestUrl';

test.each([
  ['/travel-rule/trp/protocol/inquiries/sentinel-secret?t=i', '/travel-rule/trp/protocol/inquiries/[REDACTED]?t=i'],
  ['/travel-rule/trp/protocol/resolutions/sentinel-secret', '/travel-rule/trp/protocol/resolutions/[REDACTED]'],
  ['/travel-rule/trp/protocol/confirmations/sentinel-secret', '/travel-rule/trp/protocol/confirmations/[REDACTED]'],
  ['/TRAVEL-RULE/TRP/PROTOCOL/INQUIRIES/sentinel-secret?t=i', '/TRAVEL-RULE/TRP/PROTOCOL/INQUIRIES/[REDACTED]?t=i'],
  ['/auth/password/reset-secret?token=query-secret&status=failed', '/auth/password/[REDACTED]?token=[REDACTED]&status=failed'],
  ['/auth/forgot?email=owner%40example.test&status=pending', '/auth/forgot?email=[REDACTED]&status=pending'],
  [
    '/auth/reset?old_password=old-secret&refresh_token=refresh-secret&passportNumber=passport-secret&requestIdentifier=request-123',
    '/auth/reset?old_password=[REDACTED]&refresh_token=[REDACTED]&passportNumber=[REDACTED]&requestIdentifier=request-123',
  ],
  [
    '/auth/lookup?first_name=Alice&dateOfBirth=2000-01-01&postal_code=34000&requestIdentifier=request-123',
    '/auth/lookup?first_name=[REDACTED]&dateOfBirth=[REDACTED]&postal_code=[REDACTED]&requestIdentifier=request-123',
  ],
  [
    '/auth/lookup?registration_number=acme-42&remote_addr=192.0.2.1&requestBody=opaque&search_params=opaque&requestIdentifier=request-123',
    '/auth/lookup?registration_number=[REDACTED]&remote_addr=[REDACTED]&requestBody=[REDACTED]&search_params=[REDACTED]&requestIdentifier=request-123',
  ],
  [
    '/auth/lookup?contactEmail=contact%40example.test&sender_email=sender%40example.test&billingEmail=billing%40example.test',
    '/auth/lookup?contactEmail=[REDACTED]&sender_email=[REDACTED]&billingEmail=[REDACTED]',
  ],
  ['/travel-rule/trp/transfers/id', '/travel-rule/trp/transfers/id'],
  ['/health/ready?status=full', '/health/ready?status=full'],
  [undefined, ''],
])('redacts request URL %p', (value, expected) => {
  expect(redactRequestUrl(value)).toBe(expected);
});
