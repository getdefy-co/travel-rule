import { getTravelRuleService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const getTransfer = async (req, res, next) => {
  try {
    const result = await getTravelRuleService().getTransfer(req.params.id);

    if (!result) {
      return res.status(404).json({ message: 'Not Found' });
    }

    return res.status(200).json(result);
  } catch (error) {
    return fail(error, next);
  }
};

export default getTransfer;
