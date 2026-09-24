import { invitationKeyGenerator } from '../../../src/routers/travelRule';

test('keys the invitation limit by authenticated actor id', () => {
  expect(invitationKeyGenerator({ user_id: 42 })).toBe('42');
});
