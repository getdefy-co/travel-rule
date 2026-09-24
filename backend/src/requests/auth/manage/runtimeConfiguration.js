const runtimeConfiguration = (req, res) => {
  return res.status(200).json(req.app.locals.runtimeConfiguration);
};

export default runtimeConfiguration;
