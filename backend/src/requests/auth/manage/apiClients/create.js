import { apiClientService } from '../../../../travelRule/apiClients';

const createApiClient = async (req, res, next) => {
  try {
    const client = await apiClientService.createClient({
      actorUserId: req.user_id,
      expiresAt: req.body.expires_at ? new Date(req.body.expires_at) : null,
      name: req.body.name,
      scopes: req.body.scopes,
    });

    return res.status(201).json(client);
  } catch (error) {
    return next(error);
  }
};

export default createApiClient;
