import { getOrchestrationService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const reviewComplianceCase = async (req, res, next) => {
  try {
    const outcome = await getOrchestrationService().reviewCase({
      actor: { id: req.user_id, role: req.user_role },
      decision: req.body.decision,
      expectedVersion: req.body.expected_version,
      id: req.params.id,
      reason: req.body.reason,
    });

    if (!outcome) {
      return res.status(404).json({ message: 'Compliance case not found.' });
    }

    return res.status(200).json(outcome);
  } catch (error) {
    return fail(error, next);
  }
};

export default reviewComplianceCase;
