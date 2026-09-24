import { travelRuleDB } from '@database';
import { getTravelRuleEmailService, getTravelRuleService } from '../../travelRule/runtime';

const analytics = async (req, res, next) => {
  try {
    const data = await travelRuleDB.getManagementAnalytics(Number(req.analyticsRange.slice(0, -1)));
    return res.status(200).json(data);
  } catch (error) {
    return next(error);
  }
};

const list = resource => {
  return async (req, res, next) => {
    try {
      return res.status(200).json(await travelRuleDB.listManagementResources({ resource, ...req.pagination }));
    } catch (error) {
      return next(error);
    }
  };
};

const detail = resource => {
  return async (req, res, next) => {
    try {
      const retryBefore = ['messages', 'transfers'].includes(resource) ? getTravelRuleService().getRetryBefore() : undefined;
      const data = await travelRuleDB.getManagementResource({ resource, id: req.params.id, ...(retryBefore ? { retryBefore } : {}) });
      const response = data && resource === 'transfers' ? getTravelRuleEmailService().decorateTransfer(data) : data;
      return response ? res.status(200).json(response) : res.status(404).json({ message: 'Not Found' });
    } catch (error) {
      return next(error);
    }
  };
};

const management = (req, res, next) => {
  if (req.path.endsWith('/analytics')) {
    return analytics(req, res, next);
  }

  const resource = req.path.split('/').filter(Boolean)[0];
  return req.params.id ? detail(resource)(req, res, next) : list(resource)(req, res, next);
};

export default management;
