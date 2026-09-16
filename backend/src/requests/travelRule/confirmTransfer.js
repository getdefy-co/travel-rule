import { getTravelRuleService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const confirmTransfer = async (req, res, next) => {
  try {
    const outcome = await getTravelRuleService().confirmTransfer({ canceled: req.body.canceled, id: req.params.id, txid: req.body.txid });

    if (!outcome) {
      return res.status(409).json({ message: 'Transfer cannot be confirmed in its current state.' });
    }

    return res.status(outcome.httpStatus).json(outcome.result);
  } catch (error) {
    return fail(error, next);
  }
};

export default confirmTransfer;
