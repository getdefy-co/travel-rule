import { expectRouterContract } from './routerTestUtils';

test('exposes the auth router contract', () => {
  expectRouterContract('auth', {
    mounts: ['USE /manage :: authController.isAuthenticatedWithToken > authController.isAdmin > <router>'],
    routes: [
      'POST /login :: rateLimit:1 > authController.login > @requests/auth/login',
      'POST /logout :: authController.isAuthenticatedWithToken > authController.isCsrfProtected > @requests/auth/logout',
      'GET /me :: authController.isAuthenticatedWithToken > authController.me > @requests/auth/me',
      'POST /reset :: authController.isAuthenticatedWithToken > authController.isCsrfProtected > authController.updatePassword > @requests/auth/reset',
      'POST /forgot :: rateLimit:2 > authController.forgotPassword > @requests/auth/forgot',
      'POST /password :: rateLimit:2 > authController.resetPassword > @requests/auth/password',
      'POST /manage/create :: authController.isCsrfProtected > authController.createUser > @requests/auth/manage/create',
      'GET /manage/list :: generalController.pageAndLimit > authController.listUsers > @requests/auth/manage/list',
      'POST /manage/deactivate :: authController.isCsrfProtected > authController.deactivateUser > @requests/auth/manage/deactivate',
      'POST /manage/activate :: authController.isCsrfProtected > authController.activateUser > @requests/auth/manage/activate',
      'POST /manage/edit :: authController.isCsrfProtected > authController.editUser > @requests/auth/manage/edit',
      'GET /manage/configuration/service-api-key :: @requests/auth/manage/serviceApiKey',
      'POST /manage/configuration/service-api-key/reveal :: authController.isCsrfProtected > @requests/auth/manage/serviceApiKey',
      'PUT /manage/configuration/service-api-key :: authController.isCsrfProtected > authController.validateServiceApiKey > @requests/auth/manage/serviceApiKey',
      'GET /manage/configuration/runtime :: @requests/auth/manage/runtimeConfiguration',
      'POST /manage/api-clients :: authController.isCsrfProtected > authController.validateApiClientCreate > @requests/auth/manage/apiClients/create',
      'GET /manage/api-clients :: @requests/auth/manage/apiClients/list',
      'POST /manage/api-clients/:clientId/credentials :: authController.isCsrfProtected > authController.validateApiClientIdentifiers > ' +
        'authController.validateApiClientRotation > @requests/auth/manage/apiClients/rotate',
      [
        'DELETE /manage/api-clients/:clientId/credentials/:credentialId :: authController.isCsrfProtected > ',
        'authController.validateApiClientIdentifiers > @requests/auth/manage/apiClients/revoke',
      ].join(''),
    ],
  });
});
