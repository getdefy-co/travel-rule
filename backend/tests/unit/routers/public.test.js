import { expectRouterContract, loadRouter } from './routerTestUtils';

test('exposes only public status, identity, and mutually authenticated protocol routes', () => {
  expectRouterContract('public', {
    mounts: [
      'USE /health :: <router>',
      'USE /travel-rule/trp/protocol :: <router>',
      'USE /travel-rule/trp/protocol :: travelRuleController.isMutuallyAuthenticated > travelRuleController.validateProtocolHeaders',
    ],
    routes: [
      'GET / :: <anonymous>',
      'GET /health/live :: @requests/health/live',
      'GET /health/ready :: @requests/health/ready',
      'GET /health/metrics :: @requests/health/metrics',
      'GET /identity :: @requests/travelRule/identity',
      'POST /travel-rule/trp/protocol/inquiries/:token :: @requests/travelRule/protocolInquiry',
      'POST /travel-rule/trp/protocol/resolutions/:token :: @requests/travelRule/protocolResolution',
      'POST /travel-rule/trp/protocol/confirmations/:token :: @requests/travelRule/protocolConfirmation',
    ],
  });
});

test('returns the existing public service status payload', () => {
  const router = loadRouter('public');
  const rootLayer = router.stack.find(layer => layer.route?.path === '/');
  const response = { json: jest.fn(), status: jest.fn() };

  response.status.mockReturnValue(response);
  rootLayer.route.stack[0].handle({}, response);

  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({ code: 0, message: 'Services are OK.' });
});
