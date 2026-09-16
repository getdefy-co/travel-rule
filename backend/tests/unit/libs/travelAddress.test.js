import { decodeTravelAddress, encodeTravelAddress } from '../../../src/libs/travelAddress';

test('matches the official TRP 3.2.1 Travel Address vector', () => {
  const plain = 'beneficiary.com/x/12345?t=i';
  const encoded = 'ta2W2HPKfHxgSgrzY178knqXHg1H3jfeQrwQ9JrKBs9wv';

  expect(encodeTravelAddress(plain)).toBe(encoded);
  expect(decodeTravelAddress(encoded)).toBe(plain);
});

test.each(['beneficiary.com/x/12345', 'https://beneficiary.com/x/12345?t=i', 'beneficiary/x/12345?t=i'])('rejects invalid plain Travel Address URL %s', value => {
  expect(() => encodeTravelAddress(value)).toThrow(/Travel Address/);
});

test.each(['2W2HPKfHxgSgrzY178knqXHg1H3jfeQrwQ9JrKBs9wv', 'taEJKtAQyrS5x6i59GBS2fcbcUxoR14dYiW9cZu', 'ta2W2HPKfHxgSgrzY178knqXHg1H3jfeQrwQ9JrKBs9wx'])(
  'rejects malformed or checksum-invalid encoded Travel Address %s',
  value => {
    expect(() => decodeTravelAddress(value)).toThrow(/Travel Address/);
  },
);
