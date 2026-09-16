import { getTravelRuleService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const listInquiries = async (req, res, next) => {
  try {
    const result = await getTravelRuleService().listInquiries(req.pagination);
    return res.status(200).json(result);
  } catch (error) {
    return fail(error, next);
  }
};

export default listInquiries;
