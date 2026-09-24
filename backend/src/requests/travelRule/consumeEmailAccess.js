import { getTravelRuleEmailService } from '../../travelRule/runtime';

const consumeEmailAccess = async (req, res, next) => {
  try {
    const result = await getTravelRuleEmailService().consumeToken(req.body.token);

    return result ? res.status(200).json(result) : res.status(410).json({ message: 'Link unavailable.' });
  } catch (error) {
    return next(error);
  }
};

export default consumeEmailAccess;
