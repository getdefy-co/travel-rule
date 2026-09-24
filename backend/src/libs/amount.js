const isPositiveIntegerAmount = value => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0;
  }

  return typeof value === 'string' && /^\d+$/.test(value) && /[1-9]/.test(value);
};

export { isPositiveIntegerAmount };
