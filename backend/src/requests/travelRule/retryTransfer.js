import { getTravelRuleService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const retryTransfer = async (req, res, next) => {
  try {
    const outcome = await getTravelRuleService().retryTransfer(req.params.id);

    if (!outcome) {
      return res.status(409).json({ message: 'No retryable message exists.' });
    }

    return res.status(outcome.httpStatus).json(outcome.result);
  } catch (error) {
    return fail(error, next);
  }
};

export default retryTransfer;
