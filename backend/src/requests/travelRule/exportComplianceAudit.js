import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const exportComplianceAudit = async (req, res, next) => {
  try {
    const outcome = await getOrchestrationService().exportCaseAudit({ id: req.params.id });

    if (!outcome) {
      return res.status(404).json({ message: 'Compliance case not found.' });
    }

    return res.status(200).json(outcome);
  } catch (error) {
    return fail(error, next);
  }
};

export default exportComplianceAudit;
