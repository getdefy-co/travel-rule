import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const createWebhookSubscription = async (req, res, next) => {
  try {
    const subscription = await getOrchestrationService().createWebhookSubscription({
      apiClient: req.api_client,
      eventTypes: req.body.event_types,
      secret: req.body.secret,
      url: req.body.url,
    });

    return res.status(201).json(subscription);
  } catch (error) {
    return fail(error, next);
  }
};

export default createWebhookSubscription;
