import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const listWebhookSubscriptions = async (req, res, next) => {
  try {
    const subscriptions = await getOrchestrationService().listWebhookSubscriptions({ apiClient: req.api_client });

    return res.status(200).json({ data: subscriptions });
  } catch (error) {
    return fail(error, next);
  }
};

export default listWebhookSubscriptions;
