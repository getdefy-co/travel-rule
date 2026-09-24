import { createRequest, createResponse } from '../../../../support/express';
import runtimeConfiguration from '../../../../../src/requests/auth/manage/runtimeConfiguration';

test('returns the safe runtime projection stored on the internal app', () => {
  const projection = {
    encryption: null,
    identity: null,
    integrations: { email_mode: 'disabled', oidc_enabled: false },
    mode: 'auth',
    operations: null,
  };
  const req = createRequest({ app: { locals: { runtimeConfiguration: projection } } });
  const res = createResponse();

  runtimeConfiguration(req, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(projection);
});
