import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const getComplianceCase = async (req, res, next) => {
  try {
    const complianceCase = await getOrchestrationService().getCase({ id: req.params.id });

    if (!complianceCase) {
      return res.status(404).json({ message: 'Compliance case not found.' });
    }

    return res.status(200).json(complianceCase);
  } catch (error) {
    return fail(error, next);
  }
};

export default getComplianceCase;
