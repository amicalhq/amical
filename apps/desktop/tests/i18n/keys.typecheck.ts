import { createInstance } from "i18next";

// Compiled by type:check; these checks do not need a running i18next instance.
const { t } = createInstance();

t("settings.notes.loading");
t("settings.notes.cloud.error", { reason: "Offline" });

// @ts-expect-error Unknown keys must fail even when absent from every locale.
t("loading");

// @ts-expect-error A default value must not bypass strict key checking.
t("loading", { defaultValue: "Loading..." });
