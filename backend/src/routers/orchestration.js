import { Router } from 'express';
import { authController, travelRuleController } from '@controllers';
import createOrchestrationTransfer from '@requests/travelRule/createOrchestrationTransfer';
import completeTransferInformation from '@requests/travelRule/completeTransferInformation';
import getOrchestrationTransfer from '@requests/travelRule/getOrchestrationTransfer';
import createWebhookSubscription from '@requests/travelRule/createWebhookSubscription';
import cancelOrchestrationTransfer from '@requests/travelRule/cancelOrchestrationTransfer';
import disableWebhookSubscription from '@requests/travelRule/disableWebhookSubscription';
import listWebhookSubscriptions from '@requests/travelRule/listWebhookSubscriptions';
import settleOrchestrationTransfer from '@requests/travelRule/settleOrchestrationTransfer';
import getComplianceCase from '@requests/travelRule/getComplianceCase';
import listComplianceCases from '@requests/travelRule/listComplianceCases';
import exportComplianceAudit from '@requests/travelRule/exportComplianceAudit';
import reviewComplianceCase from '@requests/travelRule/reviewComplianceCase';
import preflightConnector from '@requests/travelRule/preflightConnector';
import createReencryptionJob from '@requests/travelRule/createReencryptionJob';
import listReencryptionJobs from '@requests/travelRule/listReencryptionJobs';

const routes = Router();
const service = Router();
const cases = Router();
const encryption = Router();

service.use(authController.isAuthenticatedWithServiceApiKey);
service.post('/transfers', authController.hasTransferWriteScope, travelRuleController.validateIdempotencyKey, travelRuleController.validateOrchestrationTransferRequest, createOrchestrationTransfer);
service.get('/transfers/:id', authController.hasTransferReadScope, travelRuleController.validateIdentifier, getOrchestrationTransfer);
service.post(
  '/transfers/:id/information',
  authController.hasTransferWriteScope,
  travelRuleController.validateIdentifier,
  travelRuleController.validateTransferInformationRequest,
  completeTransferInformation,
);
service.post(
  '/transfers/:id/cancel',
  authController.hasTransferWriteScope,
  travelRuleController.validateIdentifier,
  travelRuleController.validateOrchestrationCancellationRequest,
  cancelOrchestrationTransfer,
);
service.post(
  '/transfers/:id/settlement',
  authController.hasTransferWriteScope,
  travelRuleController.validateIdentifier,
  travelRuleController.validateOrchestrationSettlementRequest,
  settleOrchestrationTransfer,
);
service.post('/webhook-subscriptions', authController.hasWebhookManageScope, travelRuleController.validateWebhookSubscriptionRequest, createWebhookSubscription);
service.get('/webhook-subscriptions', authController.hasWebhookManageScope, listWebhookSubscriptions);
service.delete('/webhook-subscriptions/:id', authController.hasWebhookManageScope, travelRuleController.validateIdentifier, disableWebhookSubscription);
service.post('/counterparties/preflight', authController.hasTransferReadScope, travelRuleController.validateConnectorPreflightRequest, preflightConnector);

cases.use(authController.isAuthenticatedWithToken, travelRuleController.isCaseViewer);
cases.get('/', travelRuleController.validateCaseQuery, listComplianceCases);
cases.get('/:id/audit', travelRuleController.validateIdentifier, exportComplianceAudit);
cases.get('/:id', travelRuleController.validateIdentifier, getComplianceCase);
cases.post(
  '/:id/decisions',
  travelRuleController.isCaseDecisionMaker,
  authController.isCsrfProtected,
  travelRuleController.validateIdentifier,
  travelRuleController.validateCaseDecisionRequest,
  reviewComplianceCase,
);

encryption.use(authController.isAuthenticatedWithToken, authController.isAdmin);
encryption.post('/reencryption-jobs', authController.isCsrfProtected, travelRuleController.validateReencryptionJobRequest, createReencryptionJob);
encryption.get('/reencryption-jobs', listReencryptionJobs);

routes.use('/cases', cases);
routes.use('/encryption', encryption);
routes.use('/', service);

export default routes;
