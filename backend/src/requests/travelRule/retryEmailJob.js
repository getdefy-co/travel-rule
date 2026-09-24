import { getTravelRuleEmailService } from '../../travelRule/runtime';

const retryEmailJob = async (req, res, next) => {
  try {
    return res.status(202).json(await getTravelRuleEmailService().retryJob(req.params.id));
  } catch (error) {
    return next(error);
  }
};

export default retryEmailJob;
