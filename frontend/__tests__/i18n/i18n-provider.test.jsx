import { render, screen } from "@testing-library/react";
import { useTranslation } from "react-i18next";

import { I18nProvider } from "@/i18n/i18n-provider";

const Consumer = () => {
  const { t } = useTranslation();
  return <span>{t("common:state.na")}</span>;
};

test("provides the configured translator to descendants", () => {
  render(
    <I18nProvider>
      <Consumer />
    </I18nProvider>,
  );
  expect(screen.getByText("N/A")).toBeInTheDocument();
});
