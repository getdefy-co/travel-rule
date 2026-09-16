import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController, travelRuleController } from '@controllers';
import confirmTransfer from '@requests/travelRule/confirmTransfer';
import createTransfer from '@requests/travelRule/createTransfer';
import createTravelAddress from '@requests/travelRule/createTravelAddress';
import decideInquiry from '@requests/travelRule/decideInquiry';
import getInquiry from '@requests/travelRule/getInquiry';
import getTransfer from '@requests/travelRule/getTransfer';
import listInquiries from '@requests/travelRule/listInquiries';
import retryTransfer from '@requests/travelRule/retryTransfer';
import managementHandler from '@requests/travelRule/management';
import consumeEmailAccess from '@requests/travelRule/consumeEmailAccess';
import createEmailInvitation from '@requests/travelRule/createEmailInvitation';
import listEmailJobs from '@requests/travelRule/listEmailJobs';
import retryEmailJob from '@requests/travelRule/retryEmailJob';
import protocol from './protocol';

const invitationKeyGenerator = req => {
  return String(req.user_id);
};

const invitationLimiter = rateLimit({
  keyGenerator: invitationKeyGenerator,
  legacyHeaders: false,
  max: 10,
  message: { code: 429, message: 'Too many email invitation requests, please try again later.' },
  standardHeaders: true,
  windowMs: 15 * 60 * 1000,
});

const emailAccessLimiter = rateLimit({
  legacyHeaders: false,
  max: 10,
  message: { code: 429, message: 'Too many email access requests, please try again later.' },
  standardHeaders: true,
  windowMs: 15 * 60 * 1000,
});

const routes = Router();
const service = Router();
const inquiries = Router();
const management = Router();

service.use(authController.isAuthenticatedWithServiceApiKey);
service.post('/travel-addresses', authController.hasTransferWriteScope, travelRuleController.validateTravelAddressRequest, createTravelAddress);
service.post('/transfers', authController.hasTransferWriteScope, travelRuleController.validateTransferRequest, createTransfer);
service.get('/transfers/:id', authController.hasTransferReadScope, travelRuleController.validateIdentifier, getTransfer);
service.post('/transfers/:id/confirm', authController.hasTransferWriteScope, travelRuleController.validateIdentifier, travelRuleController.validateConfirmationRequest, confirmTransfer);
service.post('/transfers/:id/retry', authController.hasTransferWriteScope, travelRuleController.validateIdentifier, retryTransfer);

inquiries.use(authController.isAuthenticatedWithToken, travelRuleController.isInquiryReviewer);
inquiries.get('/', travelRuleController.validateInquiryQuery, listInquiries);
inquiries.get('/:id', travelRuleController.validateIdentifier, getInquiry);
inquiries.post('/:id/decision', authController.isCsrfProtected, travelRuleController.validateIdentifier, travelRuleController.validateDecisionRequest, decideInquiry);

management.use(authController.isAuthenticatedWithToken, travelRuleController.isManagementViewer);
management.get('/analytics', travelRuleController.validateAnalyticsQuery, managementHandler);
['transfers', 'messages', 'tokens', 'events'].forEach(resource => {
  management.get(`/${resource}`, travelRuleController.validateManagementQuery, managementHandler);
  management.get(`/${resource}/:id`, resource === 'events' ? travelRuleController.validateEventIdentifier : travelRuleController.validateIdentifier, managementHandler);
});
management.get('/emails', authController.isAdmin, travelRuleController.validateEmailJobQuery, listEmailJobs);
management.post('/travel-addresses', authController.isAdmin, authController.isCsrfProtected, travelRuleController.validateTravelAddressRequest, createTravelAddress);
management.post('/transfers', authController.isAdmin, authController.isCsrfProtected, travelRuleController.validateTransferRequest, createTransfer);
management.post(
  '/transfers/:id/confirm',
  authController.isAdmin,
  authController.isCsrfProtected,
  travelRuleController.validateIdentifier,
  travelRuleController.validateConfirmationRequest,
  confirmTransfer,
);
management.post('/transfers/:id/retry', authController.isAdmin, authController.isCsrfProtected, travelRuleController.validateIdentifier, retryTransfer);
management.post(
  '/transfers/:id/email-invitations',
  authController.isAdmin,
  invitationLimiter,
  authController.isCsrfProtected,
  travelRuleController.validateIdentifier,
  travelRuleController.validateEmailInvitationRequest,
  createEmailInvitation,
);
management.post('/emails/:id/retry', authController.isAdmin, authController.isCsrfProtected, travelRuleController.validateIdentifier, retryEmailJob);

routes.use('/protocol', protocol);
routes.post('/email-access/consume', emailAccessLimiter, travelRuleController.validateEmailAccessRequest, consumeEmailAccess);
routes.use('/inquiries', inquiries);
routes.use('/management', management);
routes.use('/', service);

export default routes;
export { invitationKeyGenerator };
