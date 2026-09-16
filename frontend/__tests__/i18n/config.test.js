import i18n from "@/i18n/config";

describe("i18n configuration", () => {
  test("initializes exactly the retained English namespaces without escaping interpolated values", () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.options.fallbackLng).toContain("en");
    expect(i18n.options.ns).toEqual(["common", "auth", "modals", "enums", "errors"]);
    expect(i18n.options.interpolation.escapeValue).toBe(false);
    expect(i18n.t("common:navigation.home")).toBe("Dashboard");
    expect(i18n.t("common:navigation.logout")).toBe("Log out");
  });

  test("falls back to the key for missing values in production-like tests", () => {
    expect(i18n.t("common:missing.path.for.test")).toBe("missing.path.for.test");
  });

  test("warns about missing development keys", () => {
    const previousEnvironment = process.env.NODE_ENV;
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NODE_ENV = "development";
    i18n.options.missingKeyHandler(["en"], "common", "missing.key");
    expect(warning).toHaveBeenCalledWith('[i18n] Missing key "common:missing.key" for en');
    process.env.NODE_ENV = previousEnvironment;
    warning.mockRestore();
  });
});
