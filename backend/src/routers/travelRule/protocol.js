import { Router } from 'express';
import { travelRuleController } from '@controllers';
import protocolConfirmation from '@requests/travelRule/protocolConfirmation';
import protocolInquiry from '@requests/travelRule/protocolInquiry';
import protocolResolution from '@requests/travelRule/protocolResolution';

const routes = Router();

routes.use(travelRuleController.isMutuallyAuthenticated, travelRuleController.validateProtocolHeaders);
routes.post('/inquiries/:token', protocolInquiry);
routes.post('/resolutions/:token', protocolResolution);
routes.post('/confirmations/:token', protocolConfirmation);

export default routes;
