const fail = (error, next) => {
  if (/^(Invalid|Unable to decrypt)/.test(error?.message || '')) {
    const requestError = new Error(error.message);

    requestError.statusCode = 400;
    return next(requestError);
  }

  return next(error);
};

export { fail };
