import { getReencryptionWorker } from '../../travelRule/runtime';

const listReencryptionJobs = async (_req, res, next) => {
  try {
    return res.status(200).json({ data: await getReencryptionWorker().listJobs() });
  } catch (error) {
    return next(error);
  }
};

export default listReencryptionJobs;
