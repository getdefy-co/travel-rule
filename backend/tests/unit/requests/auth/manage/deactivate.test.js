import { runRequestContract } from '../../requestTestUtils';

runRequestContract('auth/manage/deactivate.js', {
  boundary: {
    argumentCount: 1,
    argumentKeys: ['email'],
    argumentValues: {
      email: 'engineer@example.com',
    },
    label: 'database.authDB.deactivateUser',
  },
  success: {
    code: 0,
    payloadKeys: ['code', 'data', 'message'],
    status: 200,
  },
});
