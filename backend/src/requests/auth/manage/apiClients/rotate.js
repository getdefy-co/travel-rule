import { apiClientService } from '../../../../travelRule/apiClients';

const rotateApiClientCredential = async (req, res, next) => {
  try {
    const credential = await apiClientService.rotateCredential({
      actorUserId: req.user_id,
      clientId: req.params.clientId,
      expiresAt: req.body.expires_at ? new Date(req.body.expires_at) : null,
    });

    if (!credential) {
      return res.status(404).json({ message: 'API client not found.' });
    }

    return res.status(201).json(credential);
  } catch (error) {
    return next(error);
  }
};

export default rotateApiClientCredential;
