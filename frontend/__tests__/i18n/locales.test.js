import auth from "@/i18n/locales/en/auth.json";
import common from "@/i18n/locales/en/common.json";
import enums from "@/i18n/locales/en/enums.json";
import errors from "@/i18n/locales/en/errors.json";
import modals from "@/i18n/locales/en/modals.json";

const catalogs = { auth, common, enums, errors, modals };

const flatten = (value, prefix = "") =>
  Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" ? flatten(child, path) : [[path, child]];
  });

test("all retained English locale leaves are non-empty strings", () => {
  for (const [namespace, catalog] of Object.entries(catalogs)) {
    const leaves = flatten(catalog);
    expect(leaves.length).toBeGreaterThan(0);

    for (const [key, value] of leaves) {
      expect(`${namespace}:${key}`).toMatch(/^[a-zA-Z]+:.+/);
      expect(typeof value).toBe("string");
      expect(value.trim()).not.toBe("");
    }
  }
});

test("every retained plural key has both one and other variants", () => {
  for (const catalog of Object.values(catalogs)) {
    const keys = flatten(catalog).map(([key]) => key);
    for (const key of keys.filter((candidate) => candidate.endsWith("_one"))) {
      expect(keys).toContain(key.replace(/_one$/, "_other"));
    }
    for (const key of keys.filter((candidate) => candidate.endsWith("_other"))) {
      expect(keys).toContain(key.replace(/_other$/, "_one"));
    }
  }
});

test("uses Defy Travel Rule-neutral account copy", () => {
  expect(auth.login.emailPlaceholder).toBe("user@example.com");
  expect(auth.forgot.emailPlaceholder).toBe("user@example.com");
  expect(modals.settings.theme.description).toBe("Choose your preferred color theme.");
});
