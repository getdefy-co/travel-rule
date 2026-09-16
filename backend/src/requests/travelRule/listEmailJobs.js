import { getTravelRuleEmailService } from '../../travelRule/runtime';

const listEmailJobs = async (req, res, next) => {
  try {
    return res.status(200).json(await getTravelRuleEmailService().listJobs(req.pagination));
  } catch (error) {
    return next(error);
  }
};

export default listEmailJobs;
