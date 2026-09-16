import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const settleOrchestrationTransfer = async (req, res, next) => {
  try {
    const transfer = await getOrchestrationService().settleTransfer({
      apiClient: req.api_client,
      id: req.params.id,
      settlementReference: req.body.settlement_reference,
    });

    if (!transfer) {
      return res.status(404).json({ message: 'Transfer not found.' });
    }

    return res.status(202).json(transfer);
  } catch (error) {
    return fail(error, next);
  }
};

export default settleOrchestrationTransfer;
