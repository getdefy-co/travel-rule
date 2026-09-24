import { getReencryptionWorker } from '../../travelRule/runtime';

const createReencryptionJob = async (req, res, next) => {
  try {
    const job = await getReencryptionWorker().createJob({ actorUserId: req.user_id, targetKeyId: req.body.target_key_id });
    return res.status(202).json(job);
  } catch (error) {
    return next(error);
  }
};

export default createReencryptionJob;
