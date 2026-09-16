const { test, expect } = require("@playwright/test");

test.use({ screenshot: "off", trace: "off", video: "off" });

test("covers runtime overview, scoped-client lifecycle, and legacy-key recovery", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@getdefy.co");
  await page.getByLabel("Password").fill("defyadmin");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/configuration");
  await expect(page.getByRole("region", { name: "Service configuration" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Runtime Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scoped API Clients" })).toBeVisible();
  await expect(page.getByText("TRP", { exact: true })).toBeVisible();

  const clientName = `playwright-${Date.now()}`;
  let originalKey = null;

  try {
    await page.getByRole("button", { name: "Create API client" }).click();
    const createClientDialog = page.getByRole("dialog", { name: "Create API client" });
    await createClientDialog.getByLabel("Client name").fill(clientName);
    await createClientDialog.getByLabel("transfers:read").check();
    await createClientDialog.getByRole("button", { name: "Create client" }).click();
    const createdSecretDialog = page.getByRole("dialog", { name: "Save API credential" });
    await expect(createdSecretDialog.getByLabel("API credential")).not.toHaveValue("");
    await createdSecretDialog.getByRole("button", { name: "I saved it" }).click();

    let scopedClient = page.getByRole("group", { name: `API client ${clientName}` });
    await expect(scopedClient).toBeVisible();
    await scopedClient.getByRole("button", { name: "Rotate credential" }).click();
    const rotationDialog = page.getByRole("dialog", { name: "Rotate API credential" });
    await rotationDialog.getByRole("button", { name: "Create overlapping credential" }).click();
    const rotatedSecretDialog = page.getByRole("dialog", { name: "Save API credential" });
    await expect(rotatedSecretDialog.getByLabel("API credential")).not.toHaveValue("");
    await rotatedSecretDialog.getByRole("button", { name: "I saved it" }).click();
    scopedClient = page.getByRole("group", { name: `API client ${clientName}` });
    await expect(scopedClient.getByRole("button", { name: "Revoke credential" })).toHaveCount(2);
    await scopedClient.getByRole("button", { name: "Revoke credential" }).first().click();
    const revokeConfirmation = page.getByRole("alertdialog", { name: "Revoke API credential?" });
    await revokeConfirmation.getByRole("button", { name: "Confirm revoke" }).click();
    await expect(page.getByText("API credential revoked.")).toBeVisible();

    const currentKey = page.getByLabel("Current API key");
    await expect(currentKey).toHaveAttribute("type", "password");
    await expect.poll(async () => /^.{4}\*{8}.{4}$/.test(await currentKey.inputValue())).toBe(true);
    const maskedKey = await currentKey.inputValue();
    await page.getByRole("button", { name: "Reveal" }).click();
    await expect(currentKey).toHaveAttribute("type", "text");
    originalKey = await currentKey.inputValue();
    if (!originalKey) throw new Error("Service key reveal returned an empty value.");
    const expectedMask = `${originalKey.slice(0, 4)}${"*".repeat(8)}${originalKey.slice(-4)}`;
    if (maskedKey !== expectedMask || maskedKey === originalKey) throw new Error("Service key mask does not match the documented projection.");

    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByText(/Copied to clipboard\.|Could not copy to clipboard\./)).toBeVisible();
    const newKey = `docker-ui-rotation-${Date.now()}-temporary-key`;

    await page.getByLabel("New API key").fill("short");
    await page.getByRole("button", { name: "Rotate key" }).click();
    await expect(page.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: "Use 32–256 printable" })).toHaveText("Use 32–256 printable non-whitespace ASCII characters.");
    await expect(page.getByRole("alert").filter({ hasText: "Use 32–256 printable" })).toHaveCount(0);
    await expect(page.getByLabel("New API key")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("New API key")).toBeFocused();
    await page.getByLabel("New API key").fill(newKey);
    await page.getByRole("button", { name: "Rotate key" }).click();
    const confirmation = page.getByRole("alertdialog", { name: "Rotate legacy service API key?" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Confirm rotation" }).click();
    await expect(page.getByText("Legacy service API key rotated.")).toBeVisible();
    await expect(currentKey).toHaveAttribute("type", "password");
  } finally {
    await page.evaluate(
      async ({ apiKey, name }) => {
        const csrfCookie = document.cookie
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("defy_csrf="));
        const csrfToken = csrfCookie ? decodeURIComponent(csrfCookie.slice("defy_csrf=".length)) : null;
        if (!csrfToken) throw new Error("CSRF cookie is unavailable during service key restore.");
        const restoreResponse = apiKey
          ? await fetch("/auth/manage/configuration/service-api-key", {
              method: "PUT",
              headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
              body: JSON.stringify({ api_key: apiKey }),
            })
          : null;
        const listResponse = await fetch("/auth/manage/api-clients");
        if (listResponse.status !== 200) throw new Error(`API client cleanup list returned ${listResponse.status}`);
        const client = (await listResponse.json()).data.find((item) => item.name === name);
        if (client) {
          for (const credential of client.credentials.filter((item) => !item.revoked_at)) {
            const revokeResponse = await fetch(`/auth/manage/api-clients/${encodeURIComponent(client.id)}/credentials/${encodeURIComponent(credential.id)}`, {
              method: "DELETE",
              headers: { "x-csrf-token": csrfToken },
            });
            if (![204, 404].includes(revokeResponse.status)) throw new Error(`API credential cleanup returned ${revokeResponse.status}`);
          }
        }
        if (restoreResponse && restoreResponse.status !== 200) throw new Error(`Service key restore returned ${restoreResponse.status}`);
      },
      { apiKey: originalKey, name: clientName },
    );
  }
});
