import { apiClientService } from '../../../../travelRule/apiClients';

const listApiClients = async (_req, res, next) => {
  try {
    const clients = await apiClientService.listClients();

    return res.status(200).json({ data: clients });
  } catch (error) {
    return next(error);
  }
};

export default listApiClients;
