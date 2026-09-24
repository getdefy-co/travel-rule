const cookieOptions = httpOnly => {
  return { httpOnly, path: '/', sameSite: 'strict', secure: true };
};

const logout = (_request, response) => {
  response.clearCookie('defy_session', cookieOptions(true));
  response.clearCookie('defy_csrf', cookieOptions(false));
  return response.status(200).json({ code: 0, data: null, message: 'OK' });
};

export default logout;
