import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const createOrchestrationTransfer = async (req, res, next) => {
  try {
    const outcome = await getOrchestrationService().createTransfer({
      apiClient: req.api_client,
      idempotencyKey: req.idempotency_key,
      payload: req.body,
    });
    return res.status(outcome.httpStatus).json(outcome.result);
  } catch (error) {
    return fail(error, next);
  }
};

export default createOrchestrationTransfer;
