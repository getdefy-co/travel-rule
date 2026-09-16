import { expectRouterContract, inspectRouter, loadRouter } from './routerTestUtils';

test('exposes only the auth API and health check', () => {
  delete process.env.PROTOCOL;

  expectRouterContract('index', {
    mounts: ['USE /auth :: <router>', 'USE /auth/manage :: authController.isAuthenticatedWithToken > authController.isAdmin > <router>', 'USE /health :: <router>'],
    routes: [
      'POST /auth/login :: rateLimit:1 > authController.login > @requests/auth/login',
      'POST /auth/logout :: authController.isAuthenticatedWithToken > authController.isCsrfProtected > @requests/auth/logout',
      'GET /auth/me :: authController.isAuthenticatedWithToken > authController.me > @requests/auth/me',
      'POST /auth/reset :: authController.isAuthenticatedWithToken > authController.isCsrfProtected > authController.updatePassword > @requests/auth/reset',
      'POST /auth/forgot :: rateLimit:2 > authController.forgotPassword > @requests/auth/forgot',
      'POST /auth/password :: rateLimit:2 > authController.resetPassword > @requests/auth/password',
      'POST /auth/manage/create :: authController.isCsrfProtected > authController.createUser > @requests/auth/manage/create',
      'GET /auth/manage/list :: generalController.pageAndLimit > authController.listUsers > @requests/auth/manage/list',
      'POST /auth/manage/deactivate :: authController.isCsrfProtected > authController.deactivateUser > @requests/auth/manage/deactivate',
      'POST /auth/manage/activate :: authController.isCsrfProtected > authController.activateUser > @requests/auth/manage/activate',
      'POST /auth/manage/edit :: authController.isCsrfProtected > authController.editUser > @requests/auth/manage/edit',
      'GET /auth/manage/configuration/service-api-key :: @requests/auth/manage/serviceApiKey',
      'POST /auth/manage/configuration/service-api-key/reveal :: authController.isCsrfProtected > @requests/auth/manage/serviceApiKey',
      'PUT /auth/manage/configuration/service-api-key :: authController.isCsrfProtected > authController.validateServiceApiKey > @requests/auth/manage/serviceApiKey',
      'GET /auth/manage/configuration/runtime :: @requests/auth/manage/runtimeConfiguration',
      'POST /auth/manage/api-clients :: authController.isCsrfProtected > authController.validateApiClientCreate > @requests/auth/manage/apiClients/create',
      'GET /auth/manage/api-clients :: @requests/auth/manage/apiClients/list',
      'POST /auth/manage/api-clients/:clientId/credentials :: authController.isCsrfProtected > authController.validateApiClientIdentifiers > ' +
        'authController.validateApiClientRotation > @requests/auth/manage/apiClients/rotate',
      'DELETE /auth/manage/api-clients/:clientId/credentials/:credentialId :: authController.isCsrfProtected > authController.validateApiClientIdentifiers > ' +
        '@requests/auth/manage/apiClients/revoke',
      'GET / :: <anonymous>',
      'GET /health/live :: @requests/health/live',
      'GET /health/ready :: @requests/health/ready',
      'GET /health/metrics :: @requests/health/metrics',
    ],
  });
});

test('mounts the TRP surface only for the exact TRP protocol value', () => {
  process.env.PROTOCOL = 'TRP';

  expectRouterContract('index', {
    mounts: [
      'USE /auth :: <router>',
      'USE /auth/manage :: authController.isAuthenticatedWithToken > authController.isAdmin > <router>',
      'USE /travel-rule/trp :: <router>',
      'USE /travel-rule/trp/protocol :: <router>',
      'USE /travel-rule/trp/protocol :: travelRuleController.isMutuallyAuthenticated > travelRuleController.validateProtocolHeaders',
      'USE /travel-rule/trp/inquiries :: <router>',
      'USE /travel-rule/trp/inquiries :: authController.isAuthenticatedWithToken > travelRuleController.isInquiryReviewer',
      'USE /travel-rule/trp/management :: <router>',
      'USE /travel-rule/trp/management :: authController.isAuthenticatedWithToken > travelRuleController.isManagementViewer',
      'USE /travel-rule/trp :: <router>',
      'USE /travel-rule/trp :: authController.isAuthenticatedWithServiceApiKey',
      'USE /travel-rule/v1 :: <router>',
      'USE /travel-rule/v1/cases :: <router>',
      'USE /travel-rule/v1/cases :: authController.isAuthenticatedWithToken > travelRuleController.isCaseViewer',
      'USE /travel-rule/v1/encryption :: <router>',
      'USE /travel-rule/v1/encryption :: authController.isAuthenticatedWithToken > authController.isAdmin',
      'USE /travel-rule/v1 :: <router>',
      'USE /travel-rule/v1 :: authController.isAuthenticatedWithServiceApiKey',
      'USE /health :: <router>',
    ],
    routes: [
      'POST /auth/login :: rateLimit:1 > authController.login > @requests/auth/login',
      'POST /auth/logout :: authController.isAuthenticatedWithToken > authController.isCsrfProtected > @requests/auth/logout',
      'GET /auth/me :: authController.isAuthenticatedWithToken > authController.me > @requests/auth/me',
      'POST /auth/reset :: authController.isAuthenticatedWithToken > authController.isCsrfProtected > authController.updatePassword > @requests/auth/reset',
      'POST /auth/forgot :: rateLimit:2 > authController.forgotPassword > @requests/auth/forgot',
      'POST /auth/password :: rateLimit:2 > authController.resetPassword > @requests/auth/password',
      'POST /auth/manage/create :: authController.isCsrfProtected > authController.createUser > @requests/auth/manage/create',
      'GET /auth/manage/list :: generalController.pageAndLimit > authController.listUsers > @requests/auth/manage/list',
      'POST /auth/manage/deactivate :: authController.isCsrfProtected > authController.deactivateUser > @requests/auth/manage/deactivate',
      'POST /auth/manage/activate :: authController.isCsrfProtected > authController.activateUser > @requests/auth/manage/activate',
      'POST /auth/manage/edit :: authController.isCsrfProtected > authController.editUser > @requests/auth/manage/edit',
      'GET /auth/manage/configuration/service-api-key :: @requests/auth/manage/serviceApiKey',
      'POST /auth/manage/configuration/service-api-key/reveal :: authController.isCsrfProtected > @requests/auth/manage/serviceApiKey',
      'PUT /auth/manage/configuration/service-api-key :: authController.isCsrfProtected > authController.validateServiceApiKey > @requests/auth/manage/serviceApiKey',
      'GET /auth/manage/configuration/runtime :: @requests/auth/manage/runtimeConfiguration',
      'POST /auth/manage/api-clients :: authController.isCsrfProtected > authController.validateApiClientCreate > @requests/auth/manage/apiClients/create',
      'GET /auth/manage/api-clients :: @requests/auth/manage/apiClients/list',
      'POST /auth/manage/api-clients/:clientId/credentials :: authController.isCsrfProtected > authController.validateApiClientIdentifiers > ' +
        'authController.validateApiClientRotation > @requests/auth/manage/apiClients/rotate',
      'DELETE /auth/manage/api-clients/:clientId/credentials/:credentialId :: authController.isCsrfProtected > authController.validateApiClientIdentifiers > ' +
        '@requests/auth/manage/apiClients/revoke',
      'GET /identity :: @requests/travelRule/identity',
      'POST /travel-rule/trp/protocol/inquiries/:token :: @requests/travelRule/protocolInquiry',
      'POST /travel-rule/trp/protocol/resolutions/:token :: @requests/travelRule/protocolResolution',
      'POST /travel-rule/trp/protocol/confirmations/:token :: @requests/travelRule/protocolConfirmation',
      'POST /travel-rule/trp/email-access/consume :: rateLimit:4 > travelRuleController.validateEmailAccessRequest > @requests/travelRule/consumeEmailAccess',
      'GET /travel-rule/trp/inquiries :: travelRuleController.validateInquiryQuery > @requests/travelRule/listInquiries',
      'GET /travel-rule/trp/inquiries/:id :: travelRuleController.validateIdentifier > @requests/travelRule/getInquiry',
      'POST /travel-rule/trp/inquiries/:id/decision :: authController.isCsrfProtected > travelRuleController.validateIdentifier > ' +
        'travelRuleController.validateDecisionRequest > @requests/travelRule/decideInquiry',
      'GET /travel-rule/trp/management/analytics :: travelRuleController.validateAnalyticsQuery > @requests/travelRule/management',
      'GET /travel-rule/trp/management/transfers :: travelRuleController.validateManagementQuery > @requests/travelRule/management',
      'GET /travel-rule/trp/management/transfers/:id :: travelRuleController.validateIdentifier > @requests/travelRule/management',
      'GET /travel-rule/trp/management/messages :: travelRuleController.validateManagementQuery > @requests/travelRule/management',
      'GET /travel-rule/trp/management/messages/:id :: travelRuleController.validateIdentifier > @requests/travelRule/management',
      'GET /travel-rule/trp/management/tokens :: travelRuleController.validateManagementQuery > @requests/travelRule/management',
      'GET /travel-rule/trp/management/tokens/:id :: travelRuleController.validateIdentifier > @requests/travelRule/management',
      'GET /travel-rule/trp/management/events :: travelRuleController.validateManagementQuery > @requests/travelRule/management',
      'GET /travel-rule/trp/management/events/:id :: travelRuleController.validateEventIdentifier > @requests/travelRule/management',
      'GET /travel-rule/trp/management/emails :: authController.isAdmin > travelRuleController.validateEmailJobQuery > @requests/travelRule/listEmailJobs',
      'POST /travel-rule/trp/management/travel-addresses :: authController.isAdmin > authController.isCsrfProtected > ' +
        'travelRuleController.validateTravelAddressRequest > @requests/travelRule/createTravelAddress',
      'POST /travel-rule/trp/management/transfers :: authController.isAdmin > authController.isCsrfProtected > travelRuleController.validateTransferRequest > @requests/travelRule/createTransfer',
      'POST /travel-rule/trp/management/transfers/:id/confirm :: authController.isAdmin > authController.isCsrfProtected > travelRuleController.validateIdentifier > ' +
        'travelRuleController.validateConfirmationRequest > @requests/travelRule/confirmTransfer',
      'POST /travel-rule/trp/management/transfers/:id/retry :: authController.isAdmin > authController.isCsrfProtected > travelRuleController.validateIdentifier > @requests/travelRule/retryTransfer',
      'POST /travel-rule/trp/management/transfers/:id/email-invitations :: authController.isAdmin > rateLimit:3 > authController.isCsrfProtected > ' +
        'travelRuleController.validateIdentifier > travelRuleController.validateEmailInvitationRequest > @requests/travelRule/createEmailInvitation',
      'POST /travel-rule/trp/management/emails/:id/retry :: authController.isAdmin > authController.isCsrfProtected > travelRuleController.validateIdentifier > @requests/travelRule/retryEmailJob',
      'POST /travel-rule/trp/travel-addresses :: authController.hasTransferWriteScope > travelRuleController.validateTravelAddressRequest > @requests/travelRule/createTravelAddress',
      'POST /travel-rule/trp/transfers :: authController.hasTransferWriteScope > travelRuleController.validateTransferRequest > @requests/travelRule/createTransfer',
      'GET /travel-rule/trp/transfers/:id :: authController.hasTransferReadScope > travelRuleController.validateIdentifier > @requests/travelRule/getTransfer',
      'POST /travel-rule/trp/transfers/:id/confirm :: authController.hasTransferWriteScope > travelRuleController.validateIdentifier > ' +
        'travelRuleController.validateConfirmationRequest > @requests/travelRule/confirmTransfer',
      'POST /travel-rule/trp/transfers/:id/retry :: authController.hasTransferWriteScope > travelRuleController.validateIdentifier > @requests/travelRule/retryTransfer',
      'GET /travel-rule/v1/cases :: travelRuleController.validateCaseQuery > @requests/travelRule/listComplianceCases',
      'GET /travel-rule/v1/cases/:id/audit :: travelRuleController.validateIdentifier > @requests/travelRule/exportComplianceAudit',
      'GET /travel-rule/v1/cases/:id :: travelRuleController.validateIdentifier > @requests/travelRule/getComplianceCase',
      'POST /travel-rule/v1/cases/:id/decisions :: travelRuleController.isCaseDecisionMaker > authController.isCsrfProtected > travelRuleController.validateIdentifier > ' +
        'travelRuleController.validateCaseDecisionRequest > @requests/travelRule/reviewComplianceCase',
      [
        'POST /travel-rule/v1/encryption/reencryption-jobs :: authController.isCsrfProtected > ',
        'travelRuleController.validateReencryptionJobRequest > @requests/travelRule/createReencryptionJob',
      ].join(''),
      'GET /travel-rule/v1/encryption/reencryption-jobs :: @requests/travelRule/listReencryptionJobs',
      'POST /travel-rule/v1/transfers :: authController.hasTransferWriteScope > travelRuleController.validateIdempotencyKey > ' +
        'travelRuleController.validateOrchestrationTransferRequest > ' +
        '@requests/travelRule/createOrchestrationTransfer',
      ['GET /travel-rule/v1/transfers/:id :: authController.hasTransferReadScope > ', 'travelRuleController.validateIdentifier > @requests/travelRule/getOrchestrationTransfer'].join(''),
      'POST /travel-rule/v1/transfers/:id/information :: authController.hasTransferWriteScope > travelRuleController.validateIdentifier > ' +
        'travelRuleController.validateTransferInformationRequest > @requests/travelRule/completeTransferInformation',
      'POST /travel-rule/v1/transfers/:id/cancel :: authController.hasTransferWriteScope > travelRuleController.validateIdentifier > ' +
        'travelRuleController.validateOrchestrationCancellationRequest > @requests/travelRule/cancelOrchestrationTransfer',
      'POST /travel-rule/v1/transfers/:id/settlement :: authController.hasTransferWriteScope > travelRuleController.validateIdentifier > ' +
        'travelRuleController.validateOrchestrationSettlementRequest > @requests/travelRule/settleOrchestrationTransfer',
      'POST /travel-rule/v1/webhook-subscriptions :: authController.hasWebhookManageScope > travelRuleController.validateWebhookSubscriptionRequest > ' +
        '@requests/travelRule/createWebhookSubscription',
      'GET /travel-rule/v1/webhook-subscriptions :: authController.hasWebhookManageScope > @requests/travelRule/listWebhookSubscriptions',
      ['DELETE /travel-rule/v1/webhook-subscriptions/:id :: authController.hasWebhookManageScope > ', 'travelRuleController.validateIdentifier > @requests/travelRule/disableWebhookSubscription'].join(
        '',
      ),
      [
        'POST /travel-rule/v1/counterparties/preflight :: authController.hasTransferReadScope > ',
        'travelRuleController.validateConnectorPreflightRequest > @requests/travelRule/preflightConnector',
      ].join(''),
      'GET / :: <anonymous>',
      'GET /health/live :: @requests/health/live',
      'GET /health/ready :: @requests/health/ready',
      'GET /health/metrics :: @requests/health/metrics',
    ],
  });
});

test.each([undefined, 'trp', 'TRP ', 'TRISA', 'UNKNOWN'])('keeps the TRP surface unmounted for %p', protocol => {
  if (protocol === undefined) {
    delete process.env.PROTOCOL;
  } else {
    process.env.PROTOCOL = protocol;
  }

  const router = loadRouter('index');
  const routePaths = router.stack.filter(layer => layer.route).map(layer => layer.route.path);

  expect(routePaths).not.toContain('/identity');
  expect(router.stack.some(layer => layer.contractMountPath === '/travel-rule/trp')).toBe(false);
});

test('protects inquiry review with JWT authentication and never an admin-role gate', () => {
  process.env.PROTOCOL = 'TRP';
  const contract = inspectRouter(loadRouter('index'));
  const inquiryContract = [...contract.mounts, ...contract.routes].filter(entry => entry.includes('/travel-rule/trp/inquiries'));

  expect(inquiryContract.some(entry => entry.includes('authController.isAuthenticatedWithToken'))).toBe(true);
  expect(inquiryContract.every(entry => !entry.includes('authController.isAdmin'))).toBe(true);
});

test('health handler returns the existing public service status payload', () => {
  const router = loadRouter('index');
  const healthLayer = router.stack.find(layer => layer.route?.path === '/');
  const response = { json: jest.fn(), status: jest.fn() };
  response.status.mockReturnValue(response);

  healthLayer.route.stack[0].handle({}, response);

  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({ code: 0, message: 'Services are OK.' });
});
