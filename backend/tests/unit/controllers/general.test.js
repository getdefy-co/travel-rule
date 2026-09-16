import { runControllerContract } from './controllerTestUtils';
import controller from '../../../src/controllers/general';

runControllerContract(controller);

test('exports only the remaining shared controllers', () => {
  expect(Object.keys(controller).sort()).toEqual(['checkSearch', 'pageAndLimit']);
});
