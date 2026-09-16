import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const getOrchestrationTransfer = async (req, res, next) => {
  try {
    const transfer = await getOrchestrationService().getTransfer({ apiClient: req.api_client, id: req.params.id });

    if (!transfer) {
      return res.status(404).json({ message: 'Transfer not found.' });
    }

    return res.status(200).json(transfer);
  } catch (error) {
    return fail(error, next);
  }
};

export default getOrchestrationTransfer;
