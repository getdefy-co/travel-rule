import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const listComplianceCases = async (req, res, next) => {
  try {
    return res.status(200).json(await getOrchestrationService().listCases(req.pagination));
  } catch (error) {
    return fail(error, next);
  }
};

export default listComplianceCases;
