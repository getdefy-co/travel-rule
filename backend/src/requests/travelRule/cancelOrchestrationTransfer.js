import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const cancelOrchestrationTransfer = async (req, res, next) => {
  try {
    const transfer = await getOrchestrationService().cancelTransfer({ apiClient: req.api_client, id: req.params.id, reason: req.body.reason });

    if (!transfer) {
      return res.status(404).json({ message: 'Transfer not found.' });
    }

    return res.status(200).json(transfer);
  } catch (error) {
    return fail(error, next);
  }
};

export default cancelOrchestrationTransfer;
