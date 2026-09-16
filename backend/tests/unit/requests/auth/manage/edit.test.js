import { runRequestContract } from '../../requestTestUtils';

runRequestContract('auth/manage/edit.js', {
  boundary: {
    argumentCount: 1,
    argumentKeys: ['email', 'role'],
    argumentValues: {
      email: 'engineer@example.com',
    },
    label: 'database.authDB.updateUser',
  },
  success: {
    code: 0,
    payloadKeys: ['code', 'data', 'message'],
    status: 200,
  },
});
