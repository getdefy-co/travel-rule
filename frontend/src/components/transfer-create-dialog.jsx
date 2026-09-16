"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TransferStepper } from "@/components/transfer-stepper";
import { createTrpTransfer } from "@/lib/api";
import {
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
} from "@/lib/ivms101-form";

const STEP_IDS = ["transfer", "originator", "beneficiary", "vasps", "metadata"];
const ADDRESS_OPTIONS = [...ADDRESS_TYPES];
const COUNTRY_OPTIONS = [...COUNTRY_CODES];
const LEGAL_IDENTIFICATION_OPTIONS = [...LEGAL_IDENTIFICATION_TYPES];
const LEGAL_NAME_OPTIONS = [...LEGAL_NAME_TYPES];
const NATURAL_IDENTIFICATION_OPTIONS = [...NATURAL_IDENTIFICATION_TYPES];
const NATURAL_NAME_OPTIONS = [...NATURAL_NAME_TYPES];
const TRANSLITERATION_OPTIONS = [...TRANSLITERATION_METHODS];
const ADDRESS_TEXT_FIELDS = [
  "department",
  "subDepartment",
  "streetName",
  "buildingNumber",
  "buildingName",
  "floor",
  "postBox",
  "room",
  "postcode",
  "townName",
  "townLocationName",
  "districtName",
  "countrySubDivision",
];

const fieldId = (path) => `ivms-${path.replaceAll(".", "-")}`;
const cloneValue = (value) =>
  Array.isArray(value) ? value.map(cloneValue) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)])) : value;

const SelectOptions = memo(function SelectOptions({ options }) {
  return options.map((option) => (
    <SelectItem key={typeof option === "string" ? option : option.value} value={typeof option === "string" ? option : option.value}>
      {typeof option === "string" ? option : option.label}
    </SelectItem>
  ));
});

function TextField({ error, fieldClassName, inputProps = {}, label, onChange, optional = false, path, placeholder, required = false, value }) {
  const { t } = useTranslation();
  const id = fieldId(path);
  return (
    <Field className={fieldClassName} data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>
        {label}
        {optional ? <span className="ml-1 text-xs font-normal text-muted-foreground">{t("common:resources.forms.ivms.optional")}</span> : null}
      </FieldLabel>
      <Input
        aria-label={label}
        aria-invalid={Boolean(error)}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || t("common:resources.forms.ivms.placeholders.value", { field: label })}
        required={required}
        value={value}
        {...inputProps}
      />
    </Field>
  );
}

function SelectField({ error, fieldClassName, label, onChange, options, path, placeholder, value }) {
  const { t } = useTranslation();
  return (
    <Field className={fieldClassName} data-invalid={Boolean(error)}>
      <FieldLabel>{label}</FieldLabel>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger id={fieldId(path)} aria-invalid={Boolean(error)} aria-label={label} className="w-full">
          <SelectValue placeholder={placeholder || t("common:resources.forms.ivms.placeholders.select", { field: label })} />
        </SelectTrigger>
        <SelectContent>
          <SelectOptions options={options} />
        </SelectContent>
      </Select>
    </Field>
  );
}

function StringList({ addLabel, errors, label, limit, onChange, path, placeholders, values }) {
  const { t } = useTranslation();
  const add = () => onChange([...values, ""]);
  const remove = (index) => onChange(values.filter((_, candidate) => candidate !== index));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{t("common:resources.forms.ivms.optional")}</p>
        </div>
        <Button disabled={values.length >= limit} onClick={add} size="sm" type="button" variant="outline">
          <Plus />
          {addLabel}
        </Button>
      </div>
      {values.map((value, index) => {
        const itemPath = `${path}.${index}`;
        const inputLabel = `${label} ${index + 1}`;
        return (
          <div className="flex items-end gap-2" key={itemPath}>
            <div className="flex-1">
              <TextField
                error={errors[itemPath]}
                label={inputLabel}
                onChange={(nextValue) => onChange(values.map((current, candidate) => (candidate === index ? nextValue : current)))}
                optional
                path={itemPath}
                placeholder={placeholders || t("common:resources.forms.ivms.placeholders.value", { field: inputLabel })}
                value={value}
              />
            </div>
            <Button aria-label={t("common:resources.forms.ivms.actions.removeItem", { item: inputLabel })} onClick={() => remove(index)} size="icon" type="button" variant="ghost">
              <Trash2 />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function AddressFields({ actionName, addresses, errors, labelPrefix, path, update }) {
  const { t } = useTranslation();
  const addAddress = () => update([...addresses, createIvms101Address()]);
  const updateAddress = (index, mutator) =>
    update(
      addresses.map((address, candidate) => {
        if (candidate !== index) return address;
        const next = cloneValue(address);
        mutator(next);
        return next;
      }),
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("common:resources.forms.ivms.sections.addresses")}</p>
          <p className="text-xs text-muted-foreground">{t("common:resources.forms.ivms.addressHelp")}</p>
        </div>
        <Button disabled={addresses.length >= 5} onClick={addAddress} size="sm" type="button" variant="outline">
          <Plus />
          {t("common:resources.forms.ivms.actions.addAddress", { party: actionName })}
        </Button>
      </div>
      {addresses.map((address, addressIndex) => {
        const addressPath = `${path}.${addressIndex}`;
        const addressLabel = `${labelPrefix} ${t("common:resources.forms.ivms.fields.address")} ${addressIndex + 1}`;
        return (
          <Card key={address._key}>
            <CardHeader aria-label={addressLabel} className="flex flex-row items-center justify-between" role="group">
              <CardTitle className="text-base">{addressLabel}</CardTitle>
              <Button
                aria-label={t("common:resources.forms.ivms.actions.removeAddress", { party: actionName, index: addressIndex + 1 })}
                onClick={() => update(addresses.filter((_, candidate) => candidate !== addressIndex))}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <SelectField
                error={errors[`${addressPath}.addressType`]}
                label={t("common:resources.forms.ivms.fields.addressType", { party: labelPrefix, index: addressIndex + 1 })}
                onChange={(value) =>
                  updateAddress(addressIndex, (next) => {
                    next.addressType = value;
                  })
                }
                options={ADDRESS_OPTIONS}
                path={`${addressPath}.addressType`}
                value={address.addressType}
              />
              <SelectField
                error={errors[`${addressPath}.country`]}
                label={t("common:resources.forms.ivms.fields.country", { party: labelPrefix, index: addressIndex + 1 })}
                onChange={(value) =>
                  updateAddress(addressIndex, (next) => {
                    next.country = value;
                  })
                }
                options={COUNTRY_OPTIONS}
                path={`${addressPath}.country`}
                value={address.country}
              />
              {ADDRESS_TEXT_FIELDS.map((field) => {
                const label = t(`common:resources.forms.ivms.fields.${field}`, { party: labelPrefix, index: addressIndex + 1 });
                return (
                  <TextField
                    error={errors[`${addressPath}.${field}`]}
                    key={field}
                    label={label}
                    onChange={(value) =>
                      updateAddress(addressIndex, (next) => {
                        next[field] = value;
                      })
                    }
                    optional={field !== "townName"}
                    path={`${addressPath}.${field}`}
                    required={field === "townName"}
                    value={address[field]}
                  />
                );
              })}
              <div className="sm:col-span-2">
                <StringList
                  addLabel={t("common:resources.forms.ivms.actions.addAddressLine")}
                  errors={errors}
                  label={t("common:resources.forms.ivms.fields.addressLine", { party: labelPrefix, index: addressIndex + 1 })}
                  limit={7}
                  onChange={(values) =>
                    updateAddress(addressIndex, (next) => {
                      next.addressLines = values;
                    })
                  }
                  path={`${addressPath}.addressLines`}
                  values={address.addressLines}
                />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function NationalIdentificationFields({ errors, labelPrefix, person, personType, path, updatePerson }) {
  const { t } = useTranslation();
  const identification = person.nationalIdentification;
  if (!identification) {
    return (
      <Button
        onClick={() =>
          updatePerson((next) => {
            next.nationalIdentification = createIvms101NationalIdentification();
          })
        }
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus />
        {t("common:resources.forms.ivms.actions.addNationalIdentification", { party: labelPrefix })}
      </Button>
    );
  }
  const update = (key, value) =>
    updatePerson((next) => {
      next.nationalIdentification[key] = value;
    });
  return (
    <Card>
      <CardHeader aria-label={t("common:resources.forms.ivms.sections.nationalIdentification")} className="flex flex-row items-center justify-between" role="group">
        <CardTitle className="text-base">{t("common:resources.forms.ivms.sections.nationalIdentification")}</CardTitle>
        <Button
          aria-label={t("common:resources.forms.ivms.actions.removeNationalIdentification", { party: labelPrefix })}
          onClick={() =>
            updatePerson((next) => {
              next.nationalIdentification = null;
            })
          }
          size="icon"
          type="button"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <TextField
          error={errors[`${path}.nationalIdentifier`]}
          label={t("common:resources.forms.ivms.fields.nationalIdentifier", { party: labelPrefix })}
          onChange={(value) => update("nationalIdentifier", value)}
          path={`${path}.nationalIdentifier`}
          required
          value={identification.nationalIdentifier}
        />
        <SelectField
          error={errors[`${path}.nationalIdentifierType`]}
          label={t("common:resources.forms.ivms.fields.nationalIdentifierType", { party: labelPrefix })}
          onChange={(value) => update("nationalIdentifierType", value)}
          options={personType === "natural" ? NATURAL_IDENTIFICATION_OPTIONS : LEGAL_IDENTIFICATION_OPTIONS}
          path={`${path}.nationalIdentifierType`}
          value={identification.nationalIdentifierType}
        />
        {personType === "natural" ? (
          <SelectField
            error={errors[`${path}.countryOfIssue`]}
            label={t("common:resources.forms.ivms.fields.countryOfIssue", { party: labelPrefix })}
            onChange={(value) => update("countryOfIssue", value)}
            options={COUNTRY_OPTIONS}
            path={`${path}.countryOfIssue`}
            value={identification.countryOfIssue}
          />
        ) : null}
        <TextField
          error={errors[`${path}.registrationAuthority`]}
          label={t("common:resources.forms.ivms.fields.registrationAuthority", { party: labelPrefix })}
          onChange={(value) => update("registrationAuthority", value)}
          optional
          path={`${path}.registrationAuthority`}
          placeholder={t("common:resources.forms.ivms.placeholders.registrationAuthority")}
          value={identification.registrationAuthority}
        />
      </CardContent>
    </Card>
  );
}

function NaturalPersonFields({ actionName, errors, labelPrefix, path, person, updatePerson }) {
  const { t } = useTranslation();
  const updateName = (index, key, value) =>
    updatePerson((next) => {
      next.nameIdentifiers[index][key] = value;
    });
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">{t("common:resources.forms.ivms.sections.names")}</p>
          <Button
            disabled={person.nameIdentifiers.length >= 5}
            onClick={() =>
              updatePerson((next) => {
                next.nameIdentifiers.push({ _key: `name-${Date.now()}`, primaryIdentifier: "", secondaryIdentifier: "", type: "LEGL" });
              })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus />
            {t("common:resources.forms.ivms.actions.addName")}
          </Button>
        </div>
        {person.nameIdentifiers.map((name, index) => {
          const namePath = `${path}.nameIdentifiers.${index}`;
          return (
            <Card key={name._key}>
              <CardContent className="grid gap-4 pt-6 sm:grid-cols-[1fr_1fr_12rem_auto]">
                <TextField
                  error={errors[`${namePath}.primaryIdentifier`]}
                  fieldClassName="sm:grid sm:row-span-3 sm:grid-rows-subgrid"
                  label={t("common:resources.forms.ivms.fields.primaryIdentifier", { party: labelPrefix, index: index + 1 })}
                  onChange={(value) => updateName(index, "primaryIdentifier", value)}
                  path={`${namePath}.primaryIdentifier`}
                  required
                  value={name.primaryIdentifier}
                />
                <TextField
                  error={errors[`${namePath}.secondaryIdentifier`]}
                  fieldClassName="sm:grid sm:row-span-3 sm:grid-rows-subgrid"
                  label={t("common:resources.forms.ivms.fields.secondaryIdentifier", { party: labelPrefix, index: index + 1 })}
                  onChange={(value) => updateName(index, "secondaryIdentifier", value)}
                  optional
                  path={`${namePath}.secondaryIdentifier`}
                  value={name.secondaryIdentifier}
                />
                <SelectField
                  error={errors[`${namePath}.type`]}
                  fieldClassName="sm:grid sm:row-span-3 sm:grid-rows-subgrid"
                  label={t("common:resources.forms.ivms.fields.nameType", { index: index + 1 })}
                  onChange={(value) => updateName(index, "type", value)}
                  options={NATURAL_NAME_OPTIONS}
                  path={`${namePath}.type`}
                  value={name.type}
                />
                <Button
                  aria-label={t("common:resources.forms.ivms.actions.removeName", { index: index + 1 })}
                  disabled={person.nameIdentifiers.length === 1}
                  onClick={() =>
                    updatePerson((next) => {
                      next.nameIdentifiers.splice(index, 1);
                    })
                  }
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          error={errors[`${path}.customerIdentifier`] || errors[`${path}.identification`]}
          label={t(`common:resources.forms.ivms.fields.${person.version === "2023" ? "customerIdentification" : "customerNumber"}`, { party: labelPrefix })}
          onChange={(value) =>
            updatePerson((next) => {
              next.customerIdentifier = value;
            })
          }
          optional
          path={`${path}.customerIdentifier`}
          value={person.customerIdentifier}
        />
        <SelectField
          error={errors[`${path}.countryOfResidence`]}
          label={t("common:resources.forms.ivms.fields.countryOfResidence", { party: labelPrefix })}
          onChange={(value) =>
            updatePerson((next) => {
              next.countryOfResidence = value;
            })
          }
          options={COUNTRY_OPTIONS}
          path={`${path}.countryOfResidence`}
          value={person.countryOfResidence}
        />
      </div>
      <AddressFields
        actionName={actionName}
        addresses={person.addresses}
        errors={errors}
        labelPrefix={labelPrefix}
        path={`${path}.addresses`}
        update={(addresses) =>
          updatePerson((next) => {
            next.addresses = addresses;
          })
        }
      />
      <NationalIdentificationFields errors={errors} labelPrefix={labelPrefix} person={person} personType="natural" path={`${path}.nationalIdentification`} updatePerson={updatePerson} />
      {person.dateAndPlaceOfBirth ? (
        <Card>
          <CardHeader aria-label={t("common:resources.forms.ivms.sections.birth")} className="flex flex-row items-center justify-between" role="group">
            <CardTitle className="text-base">{t("common:resources.forms.ivms.sections.birth")}</CardTitle>
            <Button
              aria-label={t("common:resources.forms.ivms.actions.removeBirth", { party: labelPrefix })}
              onClick={() =>
                updatePerson((next) => {
                  next.dateAndPlaceOfBirth = null;
                })
              }
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <TextField
              error={errors[`${path}.dateAndPlaceOfBirth.dateOfBirth`]}
              inputProps={{ type: "date" }}
              label={t("common:resources.forms.ivms.fields.dateOfBirth", { party: labelPrefix })}
              onChange={(value) =>
                updatePerson((next) => {
                  next.dateAndPlaceOfBirth.dateOfBirth = value;
                })
              }
              path={`${path}.dateAndPlaceOfBirth.dateOfBirth`}
              placeholder="YYYY-MM-DD"
              required
              value={person.dateAndPlaceOfBirth.dateOfBirth}
            />
            <TextField
              error={errors[`${path}.dateAndPlaceOfBirth.placeOfBirth`]}
              label={t("common:resources.forms.ivms.fields.placeOfBirth", { party: labelPrefix })}
              onChange={(value) =>
                updatePerson((next) => {
                  next.dateAndPlaceOfBirth.placeOfBirth = value;
                })
              }
              path={`${path}.dateAndPlaceOfBirth.placeOfBirth`}
              required
              value={person.dateAndPlaceOfBirth.placeOfBirth}
            />
          </CardContent>
        </Card>
      ) : (
        <Button
          onClick={() =>
            updatePerson((next) => {
              next.dateAndPlaceOfBirth = { dateOfBirth: "", placeOfBirth: "" };
            })
          }
          size="sm"
          type="button"
          variant="outline"
          className="ml-2"
        >
          <Plus />
          {t("common:resources.forms.ivms.actions.addBirth", { party: labelPrefix })}
        </Button>
      )}
    </div>
  );
}

function LegalPersonFields({ actionName, errors, labelPrefix, path, person, updatePerson }) {
  const { t } = useTranslation();
  const updateName = (index, key, value) =>
    updatePerson((next) => {
      next.nameIdentifiers[index][key] = value;
    });
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">{t("common:resources.forms.ivms.sections.names")}</p>
          <Button
            disabled={person.nameIdentifiers.length >= 3}
            onClick={() =>
              updatePerson((next) => {
                next.nameIdentifiers.push({ _key: `name-${Date.now()}`, legalPersonName: "", type: "LEGL" });
              })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus />
            {t("common:resources.forms.ivms.actions.addName")}
          </Button>
        </div>
        {person.nameIdentifiers.map((name, index) => {
          const namePath = `${path}.nameIdentifiers.${index}`;
          return (
            <Card key={name._key}>
              <CardContent className="grid gap-4 pt-6 sm:grid-cols-[1fr_12rem_auto]">
                <TextField
                  error={errors[`${namePath}.legalPersonName`]}
                  label={t("common:resources.forms.ivms.fields.legalPersonName", { party: labelPrefix, index: index + 1 })}
                  onChange={(value) => updateName(index, "legalPersonName", value)}
                  path={`${namePath}.legalPersonName`}
                  required
                  value={name.legalPersonName}
                />
                <SelectField
                  error={errors[`${namePath}.type`]}
                  label={t("common:resources.forms.ivms.fields.nameType", { index: index + 1 })}
                  onChange={(value) => updateName(index, "type", value)}
                  options={LEGAL_NAME_OPTIONS}
                  path={`${namePath}.type`}
                  value={name.type}
                />
                <Button
                  aria-label={t("common:resources.forms.ivms.actions.removeName", { index: index + 1 })}
                  disabled={person.nameIdentifiers.length === 1}
                  onClick={() =>
                    updatePerson((next) => {
                      next.nameIdentifiers.splice(index, 1);
                    })
                  }
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          error={errors[`${path}.customerIdentifier`] || errors[`${path}.identification`]}
          label={t(`common:resources.forms.ivms.fields.${person.version === "2023" ? "customerIdentification" : "customerNumber"}`, { party: labelPrefix })}
          onChange={(value) =>
            updatePerson((next) => {
              next.customerIdentifier = value;
            })
          }
          optional
          path={`${path}.customerIdentifier`}
          value={person.customerIdentifier}
        />
        <SelectField
          error={errors[`${path}.countryOfRegistration`]}
          label={t("common:resources.forms.ivms.fields.countryOfRegistration", { party: labelPrefix })}
          onChange={(value) =>
            updatePerson((next) => {
              next.countryOfRegistration = value;
            })
          }
          options={COUNTRY_OPTIONS}
          path={`${path}.countryOfRegistration`}
          value={person.countryOfRegistration}
        />
      </div>
      <AddressFields
        actionName={actionName}
        addresses={person.addresses}
        errors={errors}
        labelPrefix={labelPrefix}
        path={`${path}.addresses`}
        update={(addresses) =>
          updatePerson((next) => {
            next.addresses = addresses;
          })
        }
      />
      <NationalIdentificationFields errors={errors} labelPrefix={labelPrefix} person={person} personType="legal" path={`${path}.nationalIdentification`} updatePerson={updatePerson} />
    </div>
  );
}

function PersonFields({ actionName, errors, labelPrefix, path, person, title, updatePerson, version }) {
  const { t } = useTranslation();
  const activePerson = person.type === "legal" ? person.legalPerson : person.naturalPerson;
  const versionedPerson = { ...activePerson, version };
  const updateActive = (mutator) => updatePerson((next) => mutator(next.type === "legal" ? next.legalPerson : next.naturalPerson));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <StringList
          addLabel={t("common:resources.forms.ivms.actions.addPersonAccountNumber")}
          errors={errors}
          label={t("common:resources.forms.ivms.fields.personAccountNumber", { party: labelPrefix })}
          limit={20}
          onChange={(values) =>
            updatePerson((next) => {
              next.accountNumbers = values;
            })
          }
          path={`${path}.accountNumbers`}
          values={person.accountNumbers}
        />
        <SelectField
          error={errors[`${path}.type`]}
          label={t("common:resources.forms.ivms.fields.personType", { party: labelPrefix })}
          onChange={(value) =>
            updatePerson((next) => {
              next.type = value;
            })
          }
          options={[
            { label: t("common:resources.forms.ivms.personTypes.natural"), value: "natural" },
            { label: t("common:resources.forms.ivms.personTypes.legal"), value: "legal" },
          ]}
          path={`${path}.type`}
          value={person.type}
        />
        {person.type === "legal" ? (
          <LegalPersonFields actionName={actionName} errors={errors} labelPrefix={labelPrefix} path={`${path}.legalPerson`} person={versionedPerson} updatePerson={updateActive} />
        ) : (
          <NaturalPersonFields actionName={actionName} errors={errors} labelPrefix={labelPrefix} path={`${path}.naturalPerson`} person={versionedPerson} updatePerson={updateActive} />
        )}
      </CardContent>
    </Card>
  );
}

function PartyFields({ actionName, errors, label, party, path, updateParty, version }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <StringList
        addLabel={t("common:resources.forms.ivms.actions.addAccountNumber")}
        errors={errors}
        label={t("common:resources.forms.ivms.fields.accountNumber", { party: label })}
        limit={20}
        onChange={(values) =>
          updateParty((next) => {
            next.accountNumbers = values;
          })
        }
        path={`${path}.accountNumbers`}
        values={party.accountNumbers}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t("common:resources.forms.ivms.sections.persons", { party: label })}</h3>
          <p className="text-xs text-muted-foreground">{t("common:resources.forms.ivms.personHelp")}</p>
        </div>
        <Button
          disabled={party.persons.length >= 10}
          onClick={() =>
            updateParty((next) => {
              next.persons.push(createIvms101Person("natural"));
            })
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus />
          {t("common:resources.forms.ivms.actions.addPerson", { party: actionName })}
        </Button>
      </div>
      {party.persons.map((person, index) => {
        const personPath = `${path}.persons.${index}`;
        const personLabel = index === 0 ? label : t("common:resources.forms.ivms.fields.numberedPerson", { party: label, index: index + 1 });
        return (
          <div className="space-y-2" key={person._key}>
            <PersonFields
              actionName={actionName}
              errors={errors}
              labelPrefix={personLabel}
              path={personPath}
              person={person}
              title={t("common:resources.forms.ivms.fields.personTitle", { party: label, index: index + 1 })}
              updatePerson={(mutator) => updateParty((next) => mutator(next.persons[index]))}
              version={version}
            />
            {party.persons.length > 1 ? (
              <Button
                onClick={() =>
                  updateParty((next) => {
                    next.persons.splice(index, 1);
                  })
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trash2 />
                {t("common:resources.forms.ivms.actions.removePerson", { party: actionName, index: index + 1 })}
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function OptionalVasp({ actionLabel, errors, label, path, person, remove, setPerson, version }) {
  const { t } = useTranslation();
  if (!person)
    return (
      <Button onClick={() => setPerson(createIvms101Person("legal"))} type="button" variant="outline">
        <Plus />
        {actionLabel}
      </Button>
    );
  return (
    <div className="space-y-2">
      <PersonFields
        actionName={label.toLowerCase()}
        errors={errors}
        labelPrefix={label}
        path={path}
        person={person}
        title={t("common:resources.forms.ivms.fields.personTitle", { party: label, index: 1 })}
        updatePerson={(mutator) => {
          const next = cloneValue(person);
          mutator(next);
          setPerson(next);
        }}
        version={version}
      />
      <Button onClick={remove} size="sm" type="button" variant="ghost">
        <Trash2 />
        {t("common:resources.forms.ivms.actions.removeVasp", { party: label })}
      </Button>
    </div>
  );
}

const stepForErrorPath = (path) => {
  if (path === "version" || path.startsWith("transfer.")) return 0;
  if (path.startsWith("originator")) return 1;
  if (path.startsWith("beneficiary")) return 2;
  if (path.startsWith("originatingVasp") || path.startsWith("beneficiaryVasp") || path.startsWith("transferPath")) return 3;
  return 4;
};

const filterErrorsForStep = (errors, step) => Object.fromEntries(Object.entries(errors).filter(([path]) => stepForErrorPath(path) === step));

function TransferCreateDialog({ onComplete, onOpenChange, open }) {
  const { t } = useTranslation();
  const [transfer, setTransfer] = useState({ amount: "", dti: "", travelAddress: "" });
  const [form, setForm] = useState(() => createIvms101FormState());
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [errorSteps, setErrorSteps] = useState([]);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const scrollContainerRef = useRef(null);
  const panelRef = useRef(null);
  const validationNotice = useRef(null);
  const active = useRef(open);
  const submitLock = useRef(false);

  useEffect(() => {
    active.current = open;
    return () => { active.current = false; };
  }, [open]);
  const steps = STEP_IDS.map((id) => ({ id, label: t(`common:resources.forms.ivms.steps.${id}`) }));

  useEffect(() => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    panelRef.current?.focus();
  }, [activeStep]);

  useEffect(() => {
    const nextErrors = validationNotice.current;
    if (!nextErrors || !active.current) return;
    validationNotice.current = null;
    const firstInput = panelRef.current?.querySelector('[aria-invalid="true"]');
    const firstPath = Object.keys(nextErrors).find((path) => fieldId(path) === firstInput?.id)
      || Object.keys(nextErrors).find((path) => stepForErrorPath(path) === activeStep);
    const field = firstInput?.getAttribute("aria-label") || panelRef.current?.getAttribute("aria-label");
    (firstInput || panelRef.current)?.focus();
    toast.error(t("common:toasts.validation", {
      count: Object.keys(nextErrors).length,
      field,
      message: t(`common:resources.forms.ivms.validation.${nextErrors[firstPath]}`),
    }));
  }, [activeStep, errors, t]);

  const invalidateFromActiveStep = () => {
    setCompletedSteps((current) => current.filter((step) => step < activeStep));
    setErrorSteps((current) => current.filter((step) => step < activeStep));
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => stepForErrorPath(path) !== activeStep)));

  };
  const mutateForm = (mutator) => {
    invalidateFromActiveStep();
    setForm((current) => {
      const next = cloneValue(current);
      mutator(next);
      return next;
    });
  };
  const updateTransfer = (key, value) => {
    invalidateFromActiveStep();
    setTransfer((current) => ({ ...current, [key]: value }));
  };
  const validateAll = () => {
    const nextErrors = validateIvms101Form(form);
    if (!transfer.travelAddress.trim()) nextErrors["transfer.travelAddress"] = "required";
    if (!transfer.dti.trim()) nextErrors["transfer.dti"] = "required";
    if (!/^[1-9][0-9]*$/.test(transfer.amount)) nextErrors["transfer.amount"] = transfer.amount ? "amount" : "required";
    return nextErrors;
  };
  const moveToStep = (step) => {
    if (saving) return;
    setActiveStep(step);

  };
  const nextStep = () => {
    const currentErrors = filterErrorsForStep(validateAll(), activeStep);
    setErrors((current) => ({
      ...Object.fromEntries(Object.entries(current).filter(([path]) => stepForErrorPath(path) !== activeStep)),
      ...currentErrors,
    }));

    if (Object.keys(currentErrors).length) {
      validationNotice.current = currentErrors;
      setErrorSteps((current) => [...new Set([...current, activeStep])]);
      return;
    }
    setCompletedSteps((current) => [...new Set([...current, activeStep])].sort((left, right) => left - right));
    setErrorSteps((current) => current.filter((step) => step !== activeStep));
    setActiveStep((current) => Math.min(current + 1, STEP_IDS.length - 1));
  };
  const reset = () => {
    setTransfer({ amount: "", dti: "", travelAddress: "" });
    setForm(createIvms101FormState());
    setActiveStep(0);
    setCompletedSteps([]);
    setErrorSteps([]);
    setErrors({});

  };
  const close = (nextOpen) => {
    if (!nextOpen && saving) return;
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    if (activeStep < STEP_IDS.length - 1) {
      nextStep();
      return;
    }
    const nextErrors = validateAll();
    if (Object.keys(nextErrors).length) {
      validationNotice.current = nextErrors;
      const invalidSteps = [...new Set(Object.keys(nextErrors).map(stepForErrorPath))].sort((left, right) => left - right);
      const firstInvalidStep = invalidSteps[0];
      setErrors(nextErrors);
      setActiveStep(firstInvalidStep);
      setCompletedSteps((current) => current.filter((step) => step < firstInvalidStep));
      setErrorSteps(invalidSteps);

      return;
    }
    submitLock.current = true;
    setSaving(true);
    setErrors({});
    setErrorSteps([]);

    try {
      await createTrpTransfer({
        amount: transfer.amount,
        asset: { dti: transfer.dti.trim() },
        ivms101: buildIvms101Payload(form),
        travel_address: transfer.travelAddress.trim(),
      });
      if (!active.current) return;
      reset();
      onOpenChange(false);
      onComplete();
    } catch {
      if (active.current) toast.error(t("errors:api.createTrpTransfer"));
    } finally {
      submitLock.current = false;
      if (active.current) setSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={close} open={open}>
      <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-5xl" showCloseButton={!saving}>
        <form aria-label={t("common:resources.forms.transferTitle")} className="flex max-h-[92vh] min-w-0 w-full flex-col" noValidate onSubmit={submit}>
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>{t("common:resources.forms.transferTitle")}</DialogTitle>
            <DialogDescription>{t("common:resources.forms.ivms.description")}</DialogDescription>
          </DialogHeader>
          <div className="border-b px-4 py-4 sm:px-6">
            <TransferStepper
              activeStep={activeStep}
              ariaLabel={t("common:resources.forms.ivms.stepper.label")}
              completedSteps={completedSteps}
              disabled={saving}
              errorSteps={errorSteps}
              onStepChange={moveToStep}
              progressLabel={t("common:resources.forms.ivms.stepper.progress", {
                current: activeStep + 1,
                title: steps[activeStep].label,
                total: steps.length,
              })}
              steps={steps}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" ref={scrollContainerRef}>
            <section aria-label={steps[activeStep].label} className="outline-none" ref={panelRef} tabIndex={-1}>
              {activeStep === 0 ? (
                <div className="p-6">
                  <FieldGroup>
                    <SelectField
                      error={errors.version}
                      label={t("common:resources.forms.ivms.fields.version")}
                      onChange={(version) =>
                        mutateForm((next) => {
                          next.version = version;
                        })
                      }
                      options={[
                        { label: "IVMS101.2020", value: "2020" },
                        { label: "IVMS101.2023", value: "2023" },
                      ]}
                      path="version"
                      value={form.version}
                    />
                    <TextField
                      error={errors["transfer.travelAddress"]}
                      label={t("common:resources.forms.travelAddress")}
                      onChange={(travelAddress) => updateTransfer("travelAddress", travelAddress)}
                      path="transfer.travelAddress"
                      placeholder={t("common:resources.forms.ivms.placeholders.travelAddress")}
                      required
                      value={transfer.travelAddress}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField
                        error={errors["transfer.dti"]}
                        label={t("common:resources.forms.assetDti")}
                        onChange={(dti) => updateTransfer("dti", dti)}
                        path="transfer.dti"
                        placeholder={t("common:resources.forms.ivms.placeholders.dti")}
                        required
                        value={transfer.dti}
                      />
                      <TextField
                        error={errors["transfer.amount"]}
                        inputProps={{ inputMode: "numeric", pattern: "[1-9][0-9]*" }}
                        label={t("common:resources.forms.amount")}
                        onChange={(amount) => updateTransfer("amount", amount)}
                        path="transfer.amount"
                        placeholder={t("common:resources.forms.ivms.placeholders.amount")}
                        required
                        value={transfer.amount}
                      />
                    </div>
                    <FieldDescription>{t("common:resources.forms.ivms.requiredHelp")}</FieldDescription>
                  </FieldGroup>
                </div>
              ) : null}
              {activeStep === 1 ? (
                <div className="p-6">
                  <PartyFields
                    actionName={t("common:resources.forms.ivms.parties.originatorAction")}
                    errors={errors}
                    label={t("common:resources.forms.ivms.parties.originator")}
                    party={form.originator}
                    path="originator"
                    updateParty={(mutator) => mutateForm((next) => mutator(next.originator))}
                    version={form.version}
                  />
                </div>
              ) : null}
              {activeStep === 2 ? (
                <div className="p-6">
                  <PartyFields
                    actionName={t("common:resources.forms.ivms.parties.beneficiaryAction")}
                    errors={errors}
                    label={t("common:resources.forms.ivms.parties.beneficiary")}
                    party={form.beneficiary}
                    path="beneficiary"
                    updateParty={(mutator) => mutateForm((next) => mutator(next.beneficiary))}
                    version={form.version}
                  />
                </div>
              ) : null}
              {activeStep === 3 ? (
                <div className="space-y-5 p-6">
                  <OptionalVasp
                    actionLabel={t("common:resources.forms.ivms.actions.addOriginatingVasp")}
                    errors={errors}
                    label={t("common:resources.forms.ivms.parties.originatingVasp")}
                    path="originatingVasp"
                    person={form.originatingVasp}
                    remove={() =>
                      mutateForm((next) => {
                        next.originatingVasp = null;
                      })
                    }
                    setPerson={(person) =>
                      mutateForm((next) => {
                        next.originatingVasp = person;
                      })
                    }
                    version={form.version}
                  />
                  <OptionalVasp
                    actionLabel={t("common:resources.forms.ivms.actions.addBeneficiaryVasp")}
                    errors={errors}
                    label={t("common:resources.forms.ivms.parties.beneficiaryVasp")}
                    path="beneficiaryVasp"
                    person={form.beneficiaryVasp}
                    remove={() =>
                      mutateForm((next) => {
                        next.beneficiaryVasp = null;
                      })
                    }
                    setPerson={(person) =>
                      mutateForm((next) => {
                        next.beneficiaryVasp = person;
                      })
                    }
                    version={form.version}
                  />
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{t("common:resources.forms.ivms.sections.transferPath")}</h3>
                        <p className="text-xs text-muted-foreground">{t("common:resources.forms.ivms.transferPathHelp")}</p>
                      </div>
                      <Button
                        disabled={form.transferPath.length >= 5}
                        onClick={() =>
                          mutateForm((next) => {
                            next.transferPath.push(createIvms101Person("legal"));
                          })
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Plus />
                        {t("common:resources.forms.ivms.actions.addIntermediaryVasp")}
                      </Button>
                    </div>
                    {form.transferPath.map((person, index) => (
                      <div className="space-y-3" key={person._key}>
                        <TextField
                          inputProps={{ readOnly: true, type: "number" }}
                          label={t("common:resources.forms.ivms.fields.sequence", { index: index + 1 })}
                          onChange={() => {}}
                          path={`transferPath.${index}.sequence`}
                          placeholder={t("common:resources.forms.ivms.placeholders.sequence")}
                          value={index}
                        />
                        <PersonFields
                          actionName={t("common:resources.forms.ivms.parties.intermediaryVaspAction")}
                          errors={errors}
                          labelPrefix={t("common:resources.forms.ivms.parties.intermediaryVasp", { index: index + 1 })}
                          path={`transferPath.${index}`}
                          person={person}
                          title={t("common:resources.forms.ivms.fields.personTitle", { party: t("common:resources.forms.ivms.parties.intermediaryVasp", { index: index + 1 }), index: 1 })}
                          updatePerson={(mutator) => mutateForm((next) => mutator(next.transferPath[index]))}
                          version={form.version}
                        />
                        <Button
                          onClick={() =>
                            mutateForm((next) => {
                              next.transferPath.splice(index, 1);
                            })
                          }
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 />
                          {t("common:resources.forms.ivms.actions.removeIntermediaryVasp", { index: index + 1 })}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {activeStep === 4 ? (
                <div className="p-6">
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold">{t("common:resources.forms.ivms.sections.payloadMetadata")}</h3>
                      <p className="text-sm text-muted-foreground">{t("common:resources.forms.ivms.metadataHelp", { version: form.version })}</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-medium">{t("common:resources.forms.ivms.fields.transliterationMethods")}</p>
                      <Button
                        disabled={form.transliterationMethods.length >= 5}
                        onClick={() =>
                          mutateForm((next) => {
                            next.transliterationMethods.push("");
                          })
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Plus />
                        {t("common:resources.forms.ivms.actions.addTransliterationMethod")}
                      </Button>
                    </div>
                    {form.transliterationMethods.map((method, index) => (
                      <div className="flex items-end gap-2" key={`method-${index}`}>
                        <div className="flex-1">
                          <SelectField
                            error={errors.transliterationMethods}
                            label={t("common:resources.forms.ivms.fields.transliterationMethod", { index: index + 1 })}
                            onChange={(value) =>
                              mutateForm((next) => {
                                next.transliterationMethods[index] = value;
                              })
                            }
                            options={TRANSLITERATION_OPTIONS}
                            path={`transliterationMethods.${index}`}
                            value={method}
                          />
                        </div>
                        <Button
                          aria-label={t("common:resources.forms.ivms.actions.removeTransliterationMethod", { index: index + 1 })}
                          onClick={() =>
                            mutateForm((next) => {
                              next.transliterationMethods.splice(index, 1);
                            })
                          }
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
          <DialogFooter className="flex-row items-center justify-between border-t px-6 py-4 sm:justify-between">
            <Button disabled={saving} onClick={() => close(false)} type="button" variant="outline">
              {t("common:resources.actions.cancel")}
            </Button>
            <div className="flex items-center gap-2">
              <Button disabled={saving || activeStep === 0} onClick={() => moveToStep(activeStep - 1)} type="button" variant="outline">
                {t("common:resources.forms.ivms.actions.previous")}
              </Button>
              {activeStep < STEP_IDS.length - 1 ? (
                <Button
                  disabled={saving}
                  onClick={(event) => {
                    event.preventDefault();
                    nextStep();
                  }}
                  type="button"
                >
                  {t("common:resources.forms.ivms.actions.next")}
                </Button>
              ) : (
                <Button aria-busy={saving} disabled={saving} type="submit">
                  {t("common:resources.forms.createTransfer")}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { TransferCreateDialog };
