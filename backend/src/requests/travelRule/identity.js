import { getTravelRuleService } from '../../travelRule/runtime';

const identity = (req, res) => {
  return res.status(200).json(getTravelRuleService().identity);
};

export default identity;
