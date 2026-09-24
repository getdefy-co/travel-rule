const live = (_req, res) => {
  return res.status(200).json({ status: 'live' });
};

export default live;
