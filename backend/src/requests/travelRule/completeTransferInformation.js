import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const completeTransferInformation = async (req, res, next) => {
  try {
    const outcome = await getOrchestrationService().completeTransferInformation({
      apiClient: req.api_client,
      expectedVersion: req.body.expected_version,
      id: req.params.id,
      information: req.body.information,
    });

    if (!outcome) {
      return res.status(404).json({ message: 'Transfer not found.' });
    }

    return res.status(200).json(outcome);
  } catch (error) {
    return fail(error, next);
  }
};

export default completeTransferInformation;
