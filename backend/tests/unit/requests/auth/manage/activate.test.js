import { runRequestContract } from '../../requestTestUtils';

runRequestContract('auth/manage/activate.js', {
  boundary: {
    argumentCount: 1,
    argumentKeys: ['email'],
    argumentValues: {
      email: 'engineer@example.com',
    },
    label: 'database.authDB.activateUser',
  },
  success: {
    code: 0,
    payloadKeys: ['code', 'data', 'message'],
    status: 200,
  },
});
