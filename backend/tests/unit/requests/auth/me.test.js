import { runRequestContract } from '../requestTestUtils';

runRequestContract('auth/me.js', {
  boundary: {
    argumentCount: 2,
    firstArgument: 'engineer@example.com',
    label: 'database.authDB.getUser',
  },
  success: {
    code: 0,
    payloadKeys: ['code', 'data', 'message'],
    status: 200,
  },
});
