import assert from "node:assert/strict";
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import {
  defaultLocale,
  getI18nOptions,
  resources,
  supportedLocales,
} from "../../src/i18n/shared";

const placeholders = (value: string) =>
  [
    ...new Set(
      Array.from(
        value.matchAll(/{{\s*-?\s*([^},\s]+)[^}]*}}/g),
        (match) => match[1],
      ),
    ),
  ].sort();

function checkTranslations(source: unknown, target: unknown, path: string) {
  if (typeof source === "string") {
    assert(typeof target === "string", `${path}: expected a string`);
    expect(target.trim(), `${path}: empty translation`).not.toBe("");
    expect(placeholders(target), `${path}: interpolation variables`).toEqual(
      placeholders(source),
    );
    return;
  }

  assert(
    source !== null && typeof source === "object",
    `${path}: invalid source`,
  );
  assert(
    target !== null && typeof target === "object",
    `${path}: expected an object or array`,
  );
  expect(Array.isArray(target), `${path}: array structure`).toBe(
    Array.isArray(source),
  );
  expect(Object.keys(target).sort(), `${path}: translation keys`).toEqual(
    Object.keys(source).sort(),
  );
  for (const [key, value] of Object.entries(source)) {
    checkTranslations(value, Reflect.get(target, key), `${path}.${key}`);
  }
}

describe.each(supportedLocales)("%s translations", (locale) => {
  it("has every key, non-empty values, and matching interpolation variables", () => {
    checkTranslations(
      resources[defaultLocale].translation,
      resources[locale].translation,
      locale,
    );
  });

  it("resolves every translation without falling back to English", async () => {
    const instance = createInstance();
    await instance.init({ ...getI18nOptions(locale), fallbackLng: false });

    // Resolve the complete tree, including array entries, through i18next.
    for (const key of Object.keys(resources[defaultLocale].translation)) {
      const translated = instance.getFixedT(locale)(
        key as keyof typeof resources.en.translation,
        {
          returnObjects: true,
        },
      );
      expect(translated, `${locale}.${key}: unresolved translation`).toEqual(
        Reflect.get(resources[locale].translation, key),
      );
    }
  });
});
