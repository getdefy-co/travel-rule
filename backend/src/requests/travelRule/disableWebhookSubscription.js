import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const disableWebhookSubscription = async (req, res, next) => {
  try {
    const disabled = await getOrchestrationService().disableWebhookSubscription({ apiClient: req.api_client, id: req.params.id });

    if (!disabled) {
      return res.status(404).json({ message: 'Webhook subscription not found.' });
    }

    return res.status(204).send();
  } catch (error) {
    return fail(error, next);
  }
};

export default disableWebhookSubscription;
