import validator from 'validator';

const isEmptyPaginationValue = value => {
  return value === undefined || value === null || value === '';
};

const parsePaginationValue = ({ defaultValue, max, messagePrefix, min, value }) => {
  if (isEmptyPaginationValue(value)) {
    return { value: defaultValue };
  }

  if (Array.isArray(value) || typeof value === 'object' || !validator.isInt(String(value))) {
    return {
      error: `${messagePrefix} is not valid. ${messagePrefix} must be a number.`,
    };
  }

  const parsedValue = parseInt(value, 10);

  if (parsedValue < min || (max !== null && parsedValue > max)) {
    const error = max === null ? `${messagePrefix} is not valid. ${messagePrefix} must be greater than 0.` : `${messagePrefix} is not valid. ${messagePrefix} must be between ${min} and ${max}.`;

    return {
      error,
    };
  }

  return { value: parsedValue };
};

const pageAndLimit = (req, res, next) => {
  const query = req.query;
  const parsedPage = parsePaginationValue({
    defaultValue: 1,
    max: null,
    messagePrefix: 'Page',
    min: 1,
    value: query.page,
  });

  if (parsedPage.error) {
    return res.status(400).json({
      code: 400,
      message: parsedPage.error,
    });
  }

  const parsedLimit = parsePaginationValue({
    defaultValue: 10,
    max: 100,
    messagePrefix: 'Limit',
    min: 1,
    value: query.limit,
  });

  if (parsedLimit.error) {
    return res.status(400).json({
      code: 400,
      message: parsedLimit.error,
    });
  }

  const normalizedQuery = {
    ...query,
    limit: parsedLimit.value,
    page: parsedPage.value,
  };

  Object.defineProperty(req, 'query', {
    configurable: true,
    enumerable: true,
    value: normalizedQuery,
    writable: true,
  });

  next();
};

const checkSearch = (req, res, next) => {
  try {
    const { search } = req.query;

    if (search === undefined || search === null || (typeof search === 'string' && !search.trim())) {
      return res.status(400).json({
        code: 400,
        message: 'Search is required',
      });
    }

    if (typeof search !== 'string') {
      return res.status(400).json({
        code: 400,
        message: 'Search is not valid',
      });
    }

    const normalizedSearch = search.trim();

    if (!validator.isLength(normalizedSearch, { min: 1, max: 250 })) {
      return res.status(400).json({
        code: 400,
        message: 'Search is not valid',
      });
    }

    Object.defineProperty(req, 'query', {
      configurable: true,
      enumerable: true,
      value: { ...req.query, search: normalizedSearch },
      writable: true,
    });

    next();
  } catch (error) {
    return res.status(400).json({
      code: 400,
      message: 'Unknown error. Please try again.',
    });
  }
};

export default {
  pageAndLimit,
  checkSearch,
};
