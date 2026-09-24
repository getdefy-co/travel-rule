const NATURAL_NAME_TYPES = new Set(["ALIA", "BIRT", "MAID", "LEGL", "MISC"]);
const LEGAL_NAME_TYPES = new Set(["LEGL", "SHRT", "TRAD"]);
const ADDRESS_TYPES = new Set(["HOME", "BIZZ", "GEOG"]);
const NATURAL_IDENTIFICATION_TYPES = new Set(["ARNU", "CCPT", "DRLC", "FIIN", "TXID", "SOCS", "IDCD", "MISC"]);
const LEGAL_IDENTIFICATION_TYPES = new Set(["RAID", "FIIN", "TXID", "LEIX", "MISC"]);
const TRANSLITERATION_METHODS = new Set(["arab", "aran", "armn", "cyrl", "deva", "geor", "grek", "hani", "hebr", "kana", "kore", "thai", "othr"]);
const COUNTRY_CODES = new Set(
  "AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MK MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW AX XX".split(" "),
);

let itemSequence = 0;
const nextKey = () => {
  itemSequence += 1;
  return `ivms-${itemSequence}`;
};
const clean = (value) => typeof value === "string" ? value.trim() : "";
const compactStrings = (values) => values.map(clean).filter(Boolean);
const withDefined = (entries) => Object.fromEntries(entries.filter(([, value]) => value !== undefined));

const createIvms101Address = () => ({
  _key: nextKey(),
  addressType: "",
  department: "",
  subDepartment: "",
  streetName: "",
  buildingNumber: "",
  buildingName: "",
  floor: "",
  postBox: "",
  room: "",
  postcode: "",
  townName: "",
  townLocationName: "",
  districtName: "",
  countrySubDivision: "",
  country: "",
  addressLines: [],
});

const createIvms101NationalIdentification = () => ({
  nationalIdentifier: "",
  nationalIdentifierType: "",
  countryOfIssue: "",
  registrationAuthority: "",
});

const createNaturalPerson = () => ({
  nameIdentifiers: [{ _key: nextKey(), primaryIdentifier: "", secondaryIdentifier: "", type: "LEGL" }],
  addresses: [],
  nationalIdentification: null,
  customerIdentifier: "",
  dateAndPlaceOfBirth: null,
  countryOfResidence: "",
});

const createLegalPerson = () => ({
  nameIdentifiers: [{ _key: nextKey(), legalPersonName: "", type: "LEGL" }],
  addresses: [],
  nationalIdentification: null,
  customerIdentifier: "",
  countryOfRegistration: "",
});

const createIvms101Person = (type = "natural") => ({
  _key: nextKey(),
  type,
  accountNumbers: [],
  naturalPerson: createNaturalPerson(),
  legalPerson: createLegalPerson(),
});

const createIvms101FormState = () => ({
  version: "2020",
  originator: { accountNumbers: [], persons: [createIvms101Person("natural")] },
  beneficiary: { accountNumbers: [], persons: [createIvms101Person("legal")] },
  originatingVasp: null,
  beneficiaryVasp: null,
  transferPath: [],
  transliterationMethods: [],
});

const buildAddress = (address) => {
  const lines = compactStrings(address.addressLines);
  return withDefined([
    ["addressType", clean(address.addressType)],
    ["department", clean(address.department) || undefined],
    ["subDepartment", clean(address.subDepartment) || undefined],
    ["streetName", clean(address.streetName) || undefined],
    ["buildingNumber", clean(address.buildingNumber) || undefined],
    ["buildingName", clean(address.buildingName) || undefined],
    ["floor", clean(address.floor) || undefined],
    ["postBox", clean(address.postBox) || undefined],
    ["room", clean(address.room) || undefined],
    ["postcode", clean(address.postcode) || undefined],
    ["townName", clean(address.townName)],
    ["townLocationName", clean(address.townLocationName) || undefined],
    ["districtName", clean(address.districtName) || undefined],
    ["countrySubDivision", clean(address.countrySubDivision) || undefined],
    ["country", clean(address.country)],
    ["addressLine", lines.length ? lines : undefined],
  ]);
};

const buildNationalIdentification = (identification, type) => {
  if (!identification) return undefined;
  return withDefined([
    ["nationalIdentifier", clean(identification.nationalIdentifier)],
    ["nationalIdentifierType", clean(identification.nationalIdentifierType)],
    ["countryOfIssue", type === "natural" && clean(identification.countryOfIssue) ? clean(identification.countryOfIssue) : undefined],
    ["registrationAuthority", clean(identification.registrationAuthority) || undefined],
  ]);
};

const buildNaturalPerson = (person, version) => {
  const names = person.nameIdentifiers.map((name) => withDefined([
    ["primaryIdentifier", clean(name.primaryIdentifier)],
    ["secondaryIdentifier", clean(name.secondaryIdentifier) || undefined],
    [version === "2023" ? "naturalPersonNameIdentifierType" : "nameIdentifierType", clean(name.type)],
  ]));
  const addresses = person.addresses.map(buildAddress);
  const birth = person.dateAndPlaceOfBirth;
  return withDefined([
    ["name", { nameIdentifier: names }],
    ["geographicAddress", addresses.length ? addresses : undefined],
    ["nationalIdentification", buildNationalIdentification(person.nationalIdentification, "natural")],
    [version === "2023" ? "customerIdentification" : "customerNumber", clean(person.customerIdentifier) || undefined],
    ["dateAndPlaceOfBirth", birth ? { dateOfBirth: clean(birth.dateOfBirth), placeOfBirth: clean(birth.placeOfBirth) } : undefined],
    ["countryOfResidence", clean(person.countryOfResidence) || undefined],
  ]);
};

const buildLegalPerson = (person, version) => {
  const names = person.nameIdentifiers.map((name) => ({
    legalPersonName: clean(name.legalPersonName),
    legalPersonNameIdentifierType: clean(name.type),
  }));
  const addresses = person.addresses.map(buildAddress);
  return withDefined([
    ["name", { nameIdentifier: names }],
    ["geographicAddress", addresses.length ? addresses : undefined],
    ["nationalIdentification", buildNationalIdentification(person.nationalIdentification, "legal")],
    [version === "2023" ? "customerIdentification" : "customerNumber", clean(person.customerIdentifier) || undefined],
    ["countryOfRegistration", clean(person.countryOfRegistration) || undefined],
  ]);
};

const buildPerson = (person, version) => {
  const accountNumbers = compactStrings(person.accountNumbers || []);
  return withDefined([
    [person.type === "legal" ? "legalPerson" : "naturalPerson", person.type === "legal"
      ? buildLegalPerson(person.legalPerson, version)
      : buildNaturalPerson(person.naturalPerson, version)],
    ["accountNumber", accountNumbers.length ? accountNumbers : undefined],
  ]);
};

const buildParty = (party, kind, version) => {
  const personKey = version === "2023" ? `${kind}Person` : `${kind}Persons`;
  const accountNumbers = compactStrings(party.accountNumbers);
  return withDefined([
    [personKey, party.persons.map((person) => buildPerson(person, version))],
    ["accountNumber", accountNumbers.length ? accountNumbers : undefined],
  ]);
};

const buildIvms101Payload = (state) => {
  const version = state.version === "2023" ? "2023" : "2020";
  const methods = compactStrings(state.transliterationMethods);
  return withDefined([
    ["originator", buildParty(state.originator, "originator", version)],
    ["beneficiary", buildParty(state.beneficiary, "beneficiary", version)],
    ["originatingVASP", state.originatingVasp ? buildPerson(state.originatingVasp, version) : undefined],
    ["beneficiaryVASP", state.beneficiaryVasp ? buildPerson(state.beneficiaryVasp, version) : undefined],
    ["transferPath", state.transferPath.length ? {
      transferPath: state.transferPath.map((person, sequence) => ({ intermediaryVASP: buildPerson(person, version), sequence })),
    } : undefined],
    ["payloadMetadata", version === "2023"
      ? withDefined([["payloadVersion", "101.2023"], ["transliterationMethod", methods.length ? methods : undefined]])
      : methods.length ? { transliterationMethod: methods } : undefined],
  ]);
};

const validateIvms101Form = (state, now = new Date()) => {
  const errors = {};
  const add = (path, code) => {
    if (!errors[path]) errors[path] = code;
  };
  const required = (value, path) => {
    if (!clean(value)) add(path, "required");
  };
  const country = (value, path, optional = false) => {
    const code = clean(value);
    if (!code && optional) return;
    if (!COUNTRY_CODES.has(code)) add(path, code ? "country" : "required");
  };
  const validateAddress = (address, path) => {
    if (!ADDRESS_TYPES.has(clean(address.addressType))) add(`${path}.addressType`, clean(address.addressType) ? "addressType" : "required");
    required(address.townName, `${path}.townName`);
    country(address.country, `${path}.country`);
    const lines = compactStrings(address.addressLines);
    if (address.addressLines.length > 7) add(`${path}.addressLines`, "addressLineLimit");
    if (!lines.length && !(clean(address.streetName) && (clean(address.buildingName) || clean(address.buildingNumber)))) {
      add(`${path}.addressLines`, "addressStructure");
    }
  };
  const validateIdentification = (identification, type, path) => {
    if (!identification) return;
    required(identification.nationalIdentifier, `${path}.nationalIdentifier`);
    const identificationType = clean(identification.nationalIdentifierType);
    const types = type === "natural" ? NATURAL_IDENTIFICATION_TYPES : LEGAL_IDENTIFICATION_TYPES;
    if (!types.has(identificationType)) add(`${path}.nationalIdentifierType`, identificationType ? "nationalIdentifierType" : "required");
    country(identification.countryOfIssue, `${path}.countryOfIssue`, true);
    const authority = clean(identification.registrationAuthority);
    if (authority && !/^RA[0-9]{6}$/.test(authority)) add(`${path}.registrationAuthority`, "registrationAuthority");
    if (type === "legal") {
      if (clean(identification.countryOfIssue)) add(`${path}.countryOfIssue`, "legalCountryOfIssue");
      if (identificationType === "LEIX") {
        if (!/^[0-9A-Z]{18}[0-9]{2}$/.test(clean(identification.nationalIdentifier))) add(`${path}.nationalIdentifier`, "lei");
        if (authority) add(`${path}.registrationAuthority`, "leiRegistrationAuthority");
      } else if (identificationType && !authority) {
        add(`${path}.registrationAuthority`, "registrationAuthorityRequired");
      }
    }
  };
  const validateNatural = (person, path) => {
    if (person.nameIdentifiers.length < 1 || person.nameIdentifiers.length > 5) add(`${path}.nameIdentifiers`, "naturalNameLimit");
    person.nameIdentifiers.forEach((name, index) => {
      const namePath = `${path}.nameIdentifiers.${index}`;
      required(name.primaryIdentifier, `${namePath}.primaryIdentifier`);
      if (!NATURAL_NAME_TYPES.has(clean(name.type))) add(`${namePath}.type`, clean(name.type) ? "naturalNameType" : "required");
    });
    if (!person.nameIdentifiers.some((name) => clean(name.type) === "LEGL")) add(`${path}.nameIdentifiers`, "legalNameRequired");
    if (person.addresses.length > 5) add(`${path}.addresses`, "addressLimit");
    person.addresses.forEach((address, index) => validateAddress(address, `${path}.addresses.${index}`));
    validateIdentification(person.nationalIdentification, "natural", `${path}.nationalIdentification`);
    if (person.dateAndPlaceOfBirth) {
      const birthPath = `${path}.dateAndPlaceOfBirth`;
      required(person.dateAndPlaceOfBirth.dateOfBirth, `${birthPath}.dateOfBirth`);
      required(person.dateAndPlaceOfBirth.placeOfBirth, `${birthPath}.placeOfBirth`);
      const timestamp = Date.parse(person.dateAndPlaceOfBirth.dateOfBirth);
      if (clean(person.dateAndPlaceOfBirth.dateOfBirth) && (!Number.isFinite(timestamp) || timestamp >= now.getTime())) add(`${birthPath}.dateOfBirth`, "historicDate");
    }
    country(person.countryOfResidence, `${path}.countryOfResidence`, true);
    const hasEvidence = person.addresses.some((address) => ADDRESS_TYPES.has(clean(address.addressType)))
      || Boolean(clean(person.customerIdentifier))
      || Boolean(person.nationalIdentification)
      || Boolean(person.dateAndPlaceOfBirth);
    if (!hasEvidence) add(`${path}.identification`, "naturalIdentification");
  };
  const validateLegal = (person, path) => {
    if (person.nameIdentifiers.length < 1 || person.nameIdentifiers.length > 3) add(`${path}.nameIdentifiers`, "legalNameLimit");
    person.nameIdentifiers.forEach((name, index) => {
      const namePath = `${path}.nameIdentifiers.${index}`;
      required(name.legalPersonName, `${namePath}.legalPersonName`);
      if (!LEGAL_NAME_TYPES.has(clean(name.type))) add(`${namePath}.type`, clean(name.type) ? "legalNameType" : "required");
    });
    if (!person.nameIdentifiers.some((name) => clean(name.type) === "LEGL")) add(`${path}.nameIdentifiers`, "legalNameRequired");
    if (person.addresses.length > 5) add(`${path}.addresses`, "addressLimit");
    person.addresses.forEach((address, index) => validateAddress(address, `${path}.addresses.${index}`));
    validateIdentification(person.nationalIdentification, "legal", `${path}.nationalIdentification`);
    country(person.countryOfRegistration, `${path}.countryOfRegistration`, true);
    const hasEvidence = person.addresses.some((address) => clean(address.addressType) === "GEOG")
      || Boolean(clean(person.customerIdentifier))
      || Boolean(person.nationalIdentification);
    if (!hasEvidence) add(`${path}.identification`, "legalIdentification");
  };
  const validatePerson = (person, path) => {
    if ((person.accountNumbers || []).length > 20) add(`${path}.accountNumbers`, "accountLimit");
    if (person.type === "natural") validateNatural(person.naturalPerson, `${path}.naturalPerson`);
    else if (person.type === "legal") validateLegal(person.legalPerson, `${path}.legalPerson`);
    else add(`${path}.type`, "personType");
  };
  const validateParty = (party, path) => {
    if (party.persons.length < 1 || party.persons.length > 10) add(`${path}.persons`, "personLimit");
    if (party.accountNumbers.length > 20) add(`${path}.accountNumbers`, "accountLimit");
    party.persons.forEach((person, index) => validatePerson(person, `${path}.persons.${index}`));
  };

  if (!["2020", "2023"].includes(state.version)) add("version", "version");
  validateParty(state.originator, "originator");
  validateParty(state.beneficiary, "beneficiary");
  if (state.originatingVasp) validatePerson(state.originatingVasp, "originatingVasp");
  if (state.beneficiaryVasp) validatePerson(state.beneficiaryVasp, "beneficiaryVasp");
  if (state.transferPath.length > 5) add("transferPath", "transferPathLimit");
  state.transferPath.forEach((person, index) => validatePerson(person, `transferPath.${index}`));
  if (state.transliterationMethods.length > 5) add("transliterationMethods", "transliterationLimit");
  if (state.transliterationMethods.some((method) => !TRANSLITERATION_METHODS.has(clean(method)))) add("transliterationMethods", "transliterationMethod");
  return errors;
};

export {
  ADDRESS_TYPES,
  COUNTRY_CODES,
  LEGAL_IDENTIFICATION_TYPES,
  LEGAL_NAME_TYPES,
  NATURAL_IDENTIFICATION_TYPES,
  NATURAL_NAME_TYPES,
  TRANSLITERATION_METHODS,
  buildIvms101Payload,
  createIvms101Address,
  createIvms101FormState,
  createIvms101NationalIdentification,
  createIvms101Person,
  validateIvms101Form,
};
