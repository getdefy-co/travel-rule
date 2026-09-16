import { getTravelRuleService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const protocolConfirmation = async (req, res, next) => {
  try {
    const outcome = await getTravelRuleService().receiveConfirmation({ body: req.body, peerFingerprint: req.peer_fingerprint, requestIdentifier: req.request_identifier, token: req.params.token });

    if (!outcome) {
      return res.status(404).json({ message: 'Not Found' });
    }

    return res.status(204).send();
  } catch (error) {
    return fail(error, next);
  }
};

export default protocolConfirmation;
