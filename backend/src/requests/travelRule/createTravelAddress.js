import { getTravelRuleService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const createTravelAddress = async (req, res, next) => {
  try {
    const result = await getTravelRuleService().createTravelAddress({ beneficiaryReference: req.body.beneficiary_reference, ttlSeconds: req.body.ttl_seconds });
    return res.status(201).json(result);
  } catch (error) {
    return fail(error, next);
  }
};

export default createTravelAddress;
