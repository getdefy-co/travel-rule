import { getTravelRuleEmailService } from '../../travelRule/runtime';

const createEmailInvitation = async (req, res, next) => {
  try {
    const result = await getTravelRuleEmailService().createInvitation({
      actorUserId: req.user_id,
      recipientEmail: req.body.recipient_email,
      transferId: req.params.id,
    });

    return res.status(202).json(result);
  } catch (error) {
    return next(error);
  }
};

export default createEmailInvitation;
