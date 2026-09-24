import { apiClientService } from '../../../../travelRule/apiClients';

const revokeApiClientCredential = async (req, res, next) => {
  try {
    const revoked = await apiClientService.revokeCredential({
      actorUserId: req.user_id,
      clientId: req.params.clientId,
      credentialId: req.params.credentialId,
    });

    if (!revoked) {
      return res.status(404).json({ message: 'API client credential not found.' });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
};

export default revokeApiClientCredential;
