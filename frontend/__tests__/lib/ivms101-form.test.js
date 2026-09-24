import {
  buildIvms101Payload,
  createIvms101Address,
  createIvms101FormState,
  createIvms101NationalIdentification,
  createIvms101Person,
  validateIvms101Form,
} from "@/lib/ivms101-form";

const makeValidState = (version = "2020") => {
  const state = createIvms101FormState();
  state.version = version;
  state.originator.accountNumbers = [" ORIGINATOR-1 ", "ORIGINATOR-2"];
  state.originator.persons[0].accountNumbers = [" ORIGINATOR-PERSON-1 "];
  state.originator.persons[0].naturalPerson.nameIdentifiers[0] = {
    primaryIdentifier: " Example ",
    secondaryIdentifier: " Alice ",
    type: "LEGL",
  };
  state.originator.persons[0].naturalPerson.customerIdentifier = " CUSTOMER-1 ";
  state.originator.persons[0].naturalPerson.addresses = [{
    ...createIvms101Address(),
    addressType: "HOME",
    department: " Treasury ",
    streetName: " Main Street ",
    buildingNumber: " 10 ",
    townName: " Istanbul ",
    country: "TR",
    addressLines: [" Line 1 ", "Line 2"],
  }];
  state.originator.persons[0].naturalPerson.nationalIdentification = {
    ...createIvms101NationalIdentification(),
    nationalIdentifier: " ID-1 ",
    nationalIdentifierType: "IDCD",
    countryOfIssue: "TR",
  };
  state.originator.persons[0].naturalPerson.dateAndPlaceOfBirth = {
    dateOfBirth: "1990-01-01",
    placeOfBirth: " Istanbul ",
  };
  state.originator.persons[0].naturalPerson.countryOfResidence = "TR";

  state.beneficiary.accountNumbers = [" BENEFICIARY-1 "];
  state.beneficiary.persons[0].accountNumbers = [" BENEFICIARY-PERSON-1 "];
  state.beneficiary.persons[0].legalPerson.nameIdentifiers[0] = {
    legalPersonName: " Example GmbH ",
    type: "LEGL",
  };
  state.beneficiary.persons[0].legalPerson.customerIdentifier = " CUSTOMER-2 ";
  state.beneficiary.persons[0].legalPerson.countryOfRegistration = "DE";

  state.originatingVasp = createIvms101Person("legal");
  state.originatingVasp.accountNumbers = [" ORIGINATING-VASP-1 "];
  state.originatingVasp.legalPerson.nameIdentifiers[0] = { legalPersonName: " Origin VASP ", type: "LEGL" };
  state.originatingVasp.legalPerson.customerIdentifier = " VASP-1 ";

  state.beneficiaryVasp = createIvms101Person("natural");
  state.beneficiaryVasp.accountNumbers = [" BENEFICIARY-VASP-1 "];
  state.beneficiaryVasp.naturalPerson.nameIdentifiers[0] = {
    primaryIdentifier: " Beneficiary Operator ",
    secondaryIdentifier: "",
    type: "LEGL",
  };
  state.beneficiaryVasp.naturalPerson.customerIdentifier = " VASP-2 ";

  const intermediary = createIvms101Person("legal");
  intermediary.accountNumbers = [" INTERMEDIARY-VASP-1 "];
  intermediary.legalPerson.nameIdentifiers[0] = { legalPersonName: " Intermediary VASP ", type: "LEGL" };
  intermediary.legalPerson.customerIdentifier = " VASP-3 ";
  state.transferPath = [intermediary];
  state.transliterationMethods = ["arab", "cyrl"];
  return state;
};

test("maps the complete neutral form state to the preserved IVMS101.2020 contract", () => {
  const state = makeValidState("2020");

  expect(buildIvms101Payload(state)).toEqual({
    originator: {
      accountNumber: ["ORIGINATOR-1", "ORIGINATOR-2"],
      originatorPersons: [{
        accountNumber: ["ORIGINATOR-PERSON-1"],
        naturalPerson: {
          name: { nameIdentifier: [{ primaryIdentifier: "Example", secondaryIdentifier: "Alice", nameIdentifierType: "LEGL" }] },
          geographicAddress: [{
            addressType: "HOME",
            department: "Treasury",
            streetName: "Main Street",
            buildingNumber: "10",
            townName: "Istanbul",
            country: "TR",
            addressLine: ["Line 1", "Line 2"],
          }],
          nationalIdentification: { nationalIdentifier: "ID-1", nationalIdentifierType: "IDCD", countryOfIssue: "TR" },
          customerNumber: "CUSTOMER-1",
          dateAndPlaceOfBirth: { dateOfBirth: "1990-01-01", placeOfBirth: "Istanbul" },
          countryOfResidence: "TR",
        },
      }],
    },
    beneficiary: {
      accountNumber: ["BENEFICIARY-1"],
      beneficiaryPersons: [{
        accountNumber: ["BENEFICIARY-PERSON-1"],
        legalPerson: {
          name: { nameIdentifier: [{ legalPersonName: "Example GmbH", legalPersonNameIdentifierType: "LEGL" }] },
          customerNumber: "CUSTOMER-2",
          countryOfRegistration: "DE",
        },
      }],
    },
    originatingVASP: {
      accountNumber: ["ORIGINATING-VASP-1"],
      legalPerson: {
        name: { nameIdentifier: [{ legalPersonName: "Origin VASP", legalPersonNameIdentifierType: "LEGL" }] },
        customerNumber: "VASP-1",
      },
    },
    beneficiaryVASP: {
      accountNumber: ["BENEFICIARY-VASP-1"],
      naturalPerson: {
        name: { nameIdentifier: [{ primaryIdentifier: "Beneficiary Operator", nameIdentifierType: "LEGL" }] },
        customerNumber: "VASP-2",
      },
    },
    transferPath: {
      transferPath: [{
        intermediaryVASP: {
          accountNumber: ["INTERMEDIARY-VASP-1"],
          legalPerson: {
            name: { nameIdentifier: [{ legalPersonName: "Intermediary VASP", legalPersonNameIdentifierType: "LEGL" }] },
            customerNumber: "VASP-3",
          },
        },
        sequence: 0,
      }],
    },
    payloadMetadata: { transliterationMethod: ["arab", "cyrl"] },
  });
});

test("maps version-specific person keys and mandatory payload metadata for IVMS101.2023", () => {
  const state = makeValidState("2023");
  const payload = buildIvms101Payload(state);

  expect(payload.originator.originatorPerson[0].naturalPerson).toMatchObject({
    customerIdentification: "CUSTOMER-1",
    name: {
      nameIdentifier: [{
        naturalPersonNameIdentifierType: "LEGL",
        primaryIdentifier: "Example",
        secondaryIdentifier: "Alice",
      }],
    },
  });
  expect(payload.beneficiary.beneficiaryPerson[0].legalPerson).toMatchObject({
    customerIdentification: "CUSTOMER-2",
    name: { nameIdentifier: [{ legalPersonName: "Example GmbH", legalPersonNameIdentifierType: "LEGL" }] },
  });
  expect(payload.originator).not.toHaveProperty("originatorPersons");
  expect(payload.originator.originatorPerson[0].naturalPerson).not.toHaveProperty("customerNumber");
  expect(payload.payloadMetadata).toEqual({ payloadVersion: "101.2023", transliterationMethod: ["arab", "cyrl"] });
});

test("omits empty optional objects and arrays without sending inactive person branches", () => {
  const state = createIvms101FormState();
  state.originator.persons[0].naturalPerson.nameIdentifiers[0] = { primaryIdentifier: "Originator", secondaryIdentifier: "", type: "LEGL" };
  state.originator.persons[0].naturalPerson.customerIdentifier = "originator-id";
  state.beneficiary.persons[0].legalPerson.nameIdentifiers[0] = { legalPersonName: "Beneficiary Ltd", type: "LEGL" };
  state.beneficiary.persons[0].legalPerson.customerIdentifier = "beneficiary-id";

  expect(buildIvms101Payload(state)).toEqual({
    originator: {
      originatorPersons: [{
        naturalPerson: {
          name: { nameIdentifier: [{ primaryIdentifier: "Originator", nameIdentifierType: "LEGL" }] },
          customerNumber: "originator-id",
        },
      }],
    },
    beneficiary: {
      beneficiaryPersons: [{
        legalPerson: {
          name: { nameIdentifier: [{ legalPersonName: "Beneficiary Ltd", legalPersonNameIdentifierType: "LEGL" }] },
          customerNumber: "beneficiary-id",
        },
      }],
    },
  });
});

test("reports IVMS array, identity, address, date, and legal identification constraint failures", () => {
  const state = makeValidState();
  const natural = state.originator.persons[0].naturalPerson;
  const legal = state.beneficiary.persons[0].legalPerson;
  state.originator.accountNumbers = Array.from({ length: 21 }, (_, index) => `account-${index}`);
  state.originator.persons[0].accountNumbers = Array.from({ length: 21 }, (_, index) => `person-account-${index}`);
  natural.nameIdentifiers = [{ primaryIdentifier: "Alias", secondaryIdentifier: "", type: "ALIA" }];
  natural.customerIdentifier = "";
  natural.nationalIdentification = null;
  natural.dateAndPlaceOfBirth = { dateOfBirth: "2099-01-01", placeOfBirth: "Future" };
  natural.addresses[0] = { ...createIvms101Address(), addressType: "HOME", townName: "Istanbul", country: "ZZ" };
  legal.customerIdentifier = "";
  legal.addresses = [];
  legal.nationalIdentification = {
    ...createIvms101NationalIdentification(),
    nationalIdentifier: "short-lei",
    nationalIdentifierType: "LEIX",
    registrationAuthority: "RA123456",
  };
  state.transferPath = Array.from({ length: 6 }, () => createIvms101Person("legal"));
  state.transliterationMethods = ["invalid"];

  expect(validateIvms101Form(state, new Date("2026-01-01T00:00:00.000Z"))).toMatchObject({
    "originator.accountNumbers": "accountLimit",
    "originator.persons.0.accountNumbers": "accountLimit",
    "originator.persons.0.naturalPerson.nameIdentifiers": "legalNameRequired",
    "originator.persons.0.naturalPerson.addresses.0.country": "country",
    "originator.persons.0.naturalPerson.addresses.0.addressLines": "addressStructure",
    "originator.persons.0.naturalPerson.dateAndPlaceOfBirth.dateOfBirth": "historicDate",
    "beneficiary.persons.0.legalPerson.nationalIdentification.nationalIdentifier": "lei",
    "beneficiary.persons.0.legalPerson.nationalIdentification.registrationAuthority": "leiRegistrationAuthority",
    transferPath: "transferPathLimit",
    transliterationMethods: "transliterationMethod",
  });
});

test("requires conditional originator and legal-person identification evidence", () => {
  const state = createIvms101FormState();
  state.originator.persons[0].naturalPerson.nameIdentifiers[0] = { primaryIdentifier: "Originator", secondaryIdentifier: "", type: "LEGL" };
  state.beneficiary.persons[0].legalPerson.nameIdentifiers[0] = { legalPersonName: "Beneficiary", type: "LEGL" };

  expect(validateIvms101Form(state)).toMatchObject({
    "originator.persons.0.naturalPerson.identification": "naturalIdentification",
    "beneficiary.persons.0.legalPerson.identification": "legalIdentification",
  });
});

test("requires a registration authority for non-LEI legal identifiers and rejects unknown person types", () => {
  const state = makeValidState();
  state.beneficiary.persons[0].legalPerson.nationalIdentification = {
    ...createIvms101NationalIdentification(),
    nationalIdentifier: "company-1",
    nationalIdentifierType: "RAID",
  };
  state.transferPath = [{ ...createIvms101Person("legal"), type: "unknown" }];

  expect(validateIvms101Form(state)).toMatchObject({
    "beneficiary.persons.0.legalPerson.nationalIdentification.registrationAuthority": "registrationAuthorityRequired",
    "transferPath.0.type": "personType",
  });
});

test("accepts a structurally valid GEOG address as legal-person identification evidence", () => {
  const state = makeValidState();
  const legal = state.beneficiary.persons[0].legalPerson;
  legal.customerIdentifier = "";
  legal.nationalIdentification = null;
  legal.addresses = [{
    ...createIvms101Address(),
    addressType: "GEOG",
    addressLines: ["Unter den Linden 1"],
    country: "DE",
    townName: "Berlin",
  }];

  expect(validateIvms101Form(state)).not.toHaveProperty("beneficiary.persons.0.legalPerson.identification");
});

test("reports every supported upper-bound and malformed enum constraint", () => {
  const state = makeValidState();
  state.version = "unknown";
  const natural = state.originator.persons[0].naturalPerson;
  natural.nameIdentifiers = Array.from({ length: 6 }, (_, index) => ({
    primaryIdentifier: `Alias ${index}`,
    secondaryIdentifier: "",
    type: "UNKNOWN",
  }));
  natural.addresses = Array.from({ length: 6 }, (_, index) => ({
    ...createIvms101Address(),
    addressLines: index === 0 ? Array.from({ length: 8 }, () => "Line") : ["Line"],
    addressType: index === 0 ? "UNKNOWN" : "HOME",
    country: "US",
    townName: "New York",
  }));
  natural.nationalIdentification = {
    ...createIvms101NationalIdentification(),
    nationalIdentifier: "id-1",
    nationalIdentifierType: "UNKNOWN",
    registrationAuthority: "bad",
  };
  state.originator.persons.push(...Array.from({ length: 10 }, () => {
    const person = createIvms101Person("natural");
    person.naturalPerson.nameIdentifiers[0].primaryIdentifier = "Person";
    person.naturalPerson.customerIdentifier = "customer";
    return person;
  }));

  const legal = state.beneficiary.persons[0].legalPerson;
  legal.nameIdentifiers = Array.from({ length: 4 }, (_, index) => ({ legalPersonName: `Trade ${index}`, type: "UNKNOWN" }));
  legal.addresses = Array.from({ length: 6 }, () => ({
    ...createIvms101Address(),
    addressLines: ["Line"],
    addressType: "GEOG",
    country: "DE",
    townName: "Berlin",
  }));
  legal.nationalIdentification = {
    ...createIvms101NationalIdentification(),
    countryOfIssue: "DE",
    nationalIdentifier: "company-1",
    nationalIdentifierType: "UNKNOWN",
    registrationAuthority: "bad",
  };
  state.transliterationMethods = Array.from({ length: 6 }, () => "arab");

  expect(validateIvms101Form(state)).toMatchObject({
    version: "version",
    "originator.persons": "personLimit",
    "originator.persons.0.naturalPerson.nameIdentifiers": "naturalNameLimit",
    "originator.persons.0.naturalPerson.nameIdentifiers.0.type": "naturalNameType",
    "originator.persons.0.naturalPerson.addresses": "addressLimit",
    "originator.persons.0.naturalPerson.addresses.0.addressType": "addressType",
    "originator.persons.0.naturalPerson.addresses.0.addressLines": "addressLineLimit",
    "originator.persons.0.naturalPerson.nationalIdentification.nationalIdentifierType": "nationalIdentifierType",
    "originator.persons.0.naturalPerson.nationalIdentification.registrationAuthority": "registrationAuthority",
    "beneficiary.persons.0.legalPerson.nameIdentifiers": "legalNameLimit",
    "beneficiary.persons.0.legalPerson.nameIdentifiers.0.type": "legalNameType",
    "beneficiary.persons.0.legalPerson.addresses": "addressLimit",
    "beneficiary.persons.0.legalPerson.nationalIdentification.countryOfIssue": "legalCountryOfIssue",
    transliterationMethods: "transliterationLimit",
  });
});

test("maps every optional address field plus legal identification in 2023 without transliteration metadata", () => {
  const state = makeValidState("2023");
  const natural = state.originator.persons[0].naturalPerson;
  natural.addresses[0] = {
    ...natural.addresses[0],
    buildingName: "Tower",
    countrySubDivision: "Istanbul",
    districtName: "Besiktas",
    floor: "3",
    postBox: "12",
    postcode: "34000",
    room: "7",
    subDepartment: "Operations",
    townLocationName: "Europe",
  };
  natural.nationalIdentification.countryOfIssue = "";
  const legal = state.beneficiary.persons[0].legalPerson;
  legal.addresses = [{
    ...createIvms101Address(),
    addressLines: ["Unter den Linden 1"],
    addressType: "GEOG",
    country: "DE",
    townName: "Berlin",
  }];
  legal.nationalIdentification = {
    ...createIvms101NationalIdentification(),
    nationalIdentifier: "company-1",
    nationalIdentifierType: "RAID",
    registrationAuthority: "RA123456",
  };
  state.transliterationMethods = [];

  const payload = buildIvms101Payload(state);
  expect(payload.originator.originatorPerson[0].naturalPerson.geographicAddress[0]).toMatchObject({
    buildingName: "Tower",
    countrySubDivision: "Istanbul",
    districtName: "Besiktas",
    floor: "3",
    postBox: "12",
    postcode: "34000",
    room: "7",
    subDepartment: "Operations",
    townLocationName: "Europe",
  });
  expect(payload.beneficiary.beneficiaryPerson[0].legalPerson).toMatchObject({
    geographicAddress: [{ addressType: "GEOG", addressLine: ["Unter den Linden 1"], country: "DE", townName: "Berlin" }],
    nationalIdentification: {
      nationalIdentifier: "company-1",
      nationalIdentifierType: "RAID",
      registrationAuthority: "RA123456",
    },
  });
  expect(payload.payloadMetadata).toEqual({ payloadVersion: "101.2023" });
});

test("distinguishes missing enum values and accepts a legal LEI without registration authority", () => {
  const state = makeValidState();
  const natural = state.originator.persons[0].naturalPerson;
  natural.nameIdentifiers[0].type = "";
  natural.addresses[0] = {
    ...createIvms101Address(),
    streetName: "Main Street",
  };
  natural.nationalIdentification = {
    ...createIvms101NationalIdentification(),
    nationalIdentifier: "",
    nationalIdentifierType: "",
  };
  natural.customerIdentifier = 123;
  const legal = state.beneficiary.persons[0].legalPerson;
  legal.nameIdentifiers[0].type = "";
  legal.nationalIdentification = {
    ...createIvms101NationalIdentification(),
    nationalIdentifier: "529900T8BM49AURSDO55",
    nationalIdentifierType: "LEIX",
  };

  expect(validateIvms101Form(state)).toMatchObject({
    "originator.persons.0.naturalPerson.nameIdentifiers.0.type": "required",
    "originator.persons.0.naturalPerson.addresses.0.addressType": "required",
    "originator.persons.0.naturalPerson.addresses.0.country": "required",
    "originator.persons.0.naturalPerson.addresses.0.addressLines": "addressStructure",
    "originator.persons.0.naturalPerson.nationalIdentification.nationalIdentifier": "required",
    "originator.persons.0.naturalPerson.nationalIdentification.nationalIdentifierType": "required",
    "beneficiary.persons.0.legalPerson.nameIdentifiers.0.type": "required",
  });
  expect(buildIvms101Payload(state).originator.originatorPersons[0].naturalPerson).not.toHaveProperty("customerNumber");
  expect(validateIvms101Form(state)).not.toHaveProperty("beneficiary.persons.0.legalPerson.nationalIdentification.nationalIdentifier");
});
