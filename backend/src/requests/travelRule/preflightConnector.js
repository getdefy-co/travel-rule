import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const preflightConnector = async (req, res, next) => {
  try {
    const result = await getOrchestrationService().preflight({
      candidateKeys: req.body.connector_candidates,
      requiredCapabilities: req.body.required_capabilities,
    });

    return res.status(200).json(result);
  } catch (error) {
    return fail(error, next);
  }
};

export default preflightConnector;
