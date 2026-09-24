import { getTravelRuleService } from '../../travelRule/runtime';
import { fail } from './handlerUtils';

const protocolInquiry = async (req, res, next) => {
  try {
    const outcome = await getTravelRuleService().receiveInquiry({ body: req.body, peerFingerprint: req.peer_fingerprint, requestIdentifier: req.request_identifier, token: req.params.token });

    if (!outcome) {
      return res.status(404).json({ message: 'Not Found' });
    }

    return res.status(200).json({ version: '3.2.1' });
  } catch (error) {
    return fail(error, next);
  }
};

export default protocolInquiry;
