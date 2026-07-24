import { z } from "zod";

export const SYNC_KEY_MAX_LENGTH = 60;
export const SYNC_TEXT_MAX_LENGTH = 4000;

export function isAxisSyncUnicode(value: string): boolean {
  if (value.includes("\0")) return false;

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (
        index + 1 >= value.length ||
        nextCodeUnit < 0xdc00 ||
        nextCodeUnit > 0xdfff
      ) {
        return false;
      }
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }

  return true;
}

export const axisSyncKeySchema = z
  .string()
  .min(1)
  .max(SYNC_KEY_MAX_LENGTH)
  .refine(
    isAxisSyncUnicode,
    "must be well-formed Unicode without null characters",
  )
  .refine((value) => value.trim().length > 0, "must not be blank");

export const axisSyncOptionalTextSchema = z
  .string()
  .max(SYNC_TEXT_MAX_LENGTH)
  .refine(
    isAxisSyncUnicode,
    "must be well-formed Unicode without null characters",
  );

export const axisSyncRequiredTextSchema = z
  .string()
  .min(1)
  .max(SYNC_TEXT_MAX_LENGTH)
  .refine(
    isAxisSyncUnicode,
    "must be well-formed Unicode without null characters",
  );

/**
 * Repairs legacy text by removing NUL and unpaired surrogate code units, then
 * clips it without splitting a valid surrogate pair.
 */
export function sanitizeLegacySyncText(
  value: string,
  maxLength: number,
): string {
  let result = "";

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit === 0) continue;

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (
        index + 1 >= value.length ||
        nextCodeUnit < 0xdc00 ||
        nextCodeUnit > 0xdfff
      ) {
        continue;
      }

      if (result.length + 2 > maxLength) break;
      result += value[index] + value[index + 1];
      index++;
      continue;
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) continue;
    if (result.length + 1 > maxLength) break;
    result += value[index];
  }

  return result;
}
