export {
  SETTINGS_SYNC_KEY_MAX_LENGTH as SYNC_KEY_MAX_LENGTH,
  SETTINGS_SYNC_TEXT_MAX_LENGTH as SYNC_TEXT_MAX_LENGTH,
  SettingsSyncKeySchema as axisSyncKeySchema,
  SettingsSyncOptionalTextSchema as axisSyncOptionalTextSchema,
  SettingsSyncRequiredTextSchema as axisSyncRequiredTextSchema,
} from "@amical/types";

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
