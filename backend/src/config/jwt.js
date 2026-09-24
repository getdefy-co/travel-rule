const isJwtKeyConfigured = value => {
  return typeof value === 'string' && Boolean(value.trim()) && value.trim() !== 'change-me';
};

export { isJwtKeyConfigured };
