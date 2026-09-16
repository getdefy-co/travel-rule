import { getTravelRuleService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const createTransfer = async (req, res, next) => {
  try {
    const outcome = await getTravelRuleService().createOutboundTransfer({ amount: req.body.amount, asset: req.body.asset, ivms101: req.body.ivms101, travelAddress: req.body.travel_address });
    return res.status(outcome.httpStatus).json(outcome.result);
  } catch (error) {
    return fail(error, next);
  }
};

export default createTransfer;
