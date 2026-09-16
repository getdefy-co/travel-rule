import * as controllers from '../../../src/controllers/index';

jest.mock('@database', () => ({ authDB: {} }));
jest.mock('@libs', () => ({ jwt: {} }));

test('exports the controllers used by the Auth and Travel Rule APIs', () => {
  expect(Object.keys(controllers).sort()).toEqual(['authController', 'generalController', 'travelRuleController']);
  Object.values(controllers).forEach(controller => Object.values(controller).forEach(middleware => expect(typeof middleware).toBe('function')));
});

test('loads the barrel module in an isolated module registry', () => {
  let isolatedControllers;
  jest.isolateModules(() => {
    isolatedControllers = jest.requireActual('../../../src/controllers/index');
  });
  expect(Object.keys(isolatedControllers).sort()).toEqual(['authController', 'generalController', 'travelRuleController']);
});
