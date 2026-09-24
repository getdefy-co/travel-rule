import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController, generalController } from '@controllers';
import login from '@requests/auth/login';
import logout from '@requests/auth/logout';
import me from '@requests/auth/me';
import reset from '@requests/auth/reset';
import forgotPassword from '@requests/auth/forgot';
import resetPassword from '@requests/auth/password';
import userCreate from '@requests/auth/manage/create';
import userList from '@requests/auth/manage/list';
import userDeactivate from '@requests/auth/manage/deactivate';
import userActivate from '@requests/auth/manage/activate';
import userEdit from '@requests/auth/manage/edit';
import runtimeConfiguration from '@requests/auth/manage/runtimeConfiguration';
import serviceApiKey from '@requests/auth/manage/serviceApiKey';
import createApiClient from '@requests/auth/manage/apiClients/create';
import listApiClients from '@requests/auth/manage/apiClients/list';
import revokeApiClientCredential from '@requests/auth/manage/apiClients/revoke';
import rotateApiClientCredential from '@requests/auth/manage/apiClients/rotate';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: 'Too many authentication attempts, please try again later.' },
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: 'Too many password reset requests, please try again later.' },
});

const models = Router();
const manageModels = Router();

models.post('/login', authLimiter, authController.login, login);
models.post('/logout', authController.isAuthenticatedWithToken, authController.isCsrfProtected, logout);
models.get('/me', authController.isAuthenticatedWithToken, authController.me, me);
models.post('/reset', authController.isAuthenticatedWithToken, authController.isCsrfProtected, authController.updatePassword, reset);
models.post('/forgot', passwordResetLimiter, authController.forgotPassword, forgotPassword);
models.post('/password', passwordResetLimiter, authController.resetPassword, resetPassword);

manageModels.post('/create', authController.isCsrfProtected, authController.createUser, userCreate);
manageModels.get('/list', generalController.pageAndLimit, authController.listUsers, userList);
manageModels.post('/deactivate', authController.isCsrfProtected, authController.deactivateUser, userDeactivate);
manageModels.post('/activate', authController.isCsrfProtected, authController.activateUser, userActivate);
manageModels.post('/edit', authController.isCsrfProtected, authController.editUser, userEdit);
manageModels.get('/configuration/service-api-key', serviceApiKey);
manageModels.post('/configuration/service-api-key/reveal', authController.isCsrfProtected, serviceApiKey);
manageModels.put('/configuration/service-api-key', authController.isCsrfProtected, authController.validateServiceApiKey, serviceApiKey);
manageModels.get('/configuration/runtime', runtimeConfiguration);
manageModels.post('/api-clients', authController.isCsrfProtected, authController.validateApiClientCreate, createApiClient);
manageModels.get('/api-clients', listApiClients);
manageModels.post(
  '/api-clients/:clientId/credentials',
  authController.isCsrfProtected,
  authController.validateApiClientIdentifiers,
  authController.validateApiClientRotation,
  rotateApiClientCredential,
);
manageModels.delete('/api-clients/:clientId/credentials/:credentialId', authController.isCsrfProtected, authController.validateApiClientIdentifiers, revokeApiClientCredential);

models.use('/manage', authController.isAuthenticatedWithToken, authController.isAdmin, manageModels);

export default models;
