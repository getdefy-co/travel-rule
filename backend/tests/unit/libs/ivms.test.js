import { fromCanonicalIvms, toCanonicalIvms } from '../../../src/libs/ivms';

const ivms2020 = {
  originator: {
    originatorPersons: [
      {
        naturalPerson: {
          name: { nameIdentifier: [{ primaryIdentifier: 'Smith', secondaryIdentifier: 'John', nameIdentifierType: 'LEGL' }] },
          geographicAddress: [{ addressType: 'HOME', addressLine: ['Main Street 1'], townName: 'New York', country: 'US' }],
          customerNumber: '123456',
        },
      },
    ],
    accountNumber: ['ACC001'],
  },
  beneficiary: {
    beneficiaryPersons: [
      {
        legalPerson: {
          name: { nameIdentifier: [{ legalPersonName: 'Acme Corp', legalPersonNameIdentifierType: 'LEGL' }] },
          geographicAddress: [{ addressType: 'GEOG', addressLine: ['Business Avenue 2'], townName: 'Los Angeles', country: 'US' }],
          customerNumber: '789012',
        },
      },
    ],
    accountNumber: ['ACC002'],
  },
};

test('validates 2020 wire data and normalizes it to canonical IVMS 101.2023', () => {
  const canonical = toCanonicalIvms(ivms2020);

  expect(canonical.payloadMetadata.payloadVersion).toBe('101.2023');
  expect(canonical.originator.originatorPerson).toHaveLength(1);
  expect(canonical.originator.accountNumber).toEqual(['ACC001']);
  expect(canonical.beneficiary.accountNumber).toEqual(['ACC002']);

  const wire = fromCanonicalIvms(canonical);
  expect(wire.originator.originatorPersons).toHaveLength(1);
  expect(wire.originator.accountNumber).toEqual(['ACC001']);
  expect(wire.beneficiary.accountNumber).toEqual(['ACC002']);
});

test('rejects invalid IVMS payloads', () => {
  expect(() => toCanonicalIvms({ originator: {} })).toThrow(/IVMS 101/);
});

test('accepts an already canonical IVMS 101.2023 payload', () => {
  const canonical = toCanonicalIvms(ivms2020);
  expect(toCanonicalIvms(canonical)).toEqual(canonical);
});
