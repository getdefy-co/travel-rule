const createRequest = overrides => ({
  body: {},
  headers: {},
  originalUrl: '/',
  params: {},
  query: {},
  ...overrides,
});

const createResponse = () => {
  const res = {};

  res.clearCookie = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);

  return res;
};

const createMiddlewareContext = requestOverrides => ({
  next: jest.fn(),
  req: createRequest(requestOverrides),
  res: createResponse(),
});

export { createMiddlewareContext, createRequest, createResponse };
