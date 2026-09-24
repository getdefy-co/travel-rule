import { getTravelRuleService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const decideInquiry = async (req, res, next) => {
  try {
    const outcome = await getTravelRuleService().decideInquiry({
      actor: { email: req.email, role: req.user_role, userId: req.user_id },
      decision: req.body.decision,
      id: req.params.id,
      paymentAddress: req.body.payment_address,
      reason: req.body.reason,
    });

    if (!outcome) {
      return res.status(409).json({ message: 'Inquiry cannot be decided in its current state.' });
    }

    return res.status(outcome.httpStatus).json(outcome.result);
  } catch (error) {
    return fail(error, next);
  }
};

export default decideInquiry;
