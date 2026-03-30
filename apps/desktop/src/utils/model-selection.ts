import {
  PROVIDER_TYPES,
  getSystemProviderInstanceId,
} from "../constants/provider-types";

const MODEL_SELECTION_SEPARATOR = "::";

export type ModelSelectionType = "speech" | "language" | "embedding";

export interface ParsedModelSelectionKey {
  providerInstanceId: string;
  type: ModelSelectionType;
  id: string;
}

export function getModelSelectionKey(
  providerInstanceId: string,
  type: ModelSelectionType | string,
  id: string,
): string {
  return [providerInstanceId, type, id].join(MODEL_SELECTION_SEPARATOR);
}

export function parseModelSelectionKey(
  value: string,
): ParsedModelSelectionKey | null {
  const firstSeparatorIndex = value.indexOf(MODEL_SELECTION_SEPARATOR);
  if (firstSeparatorIndex === -1) {
    return null;
  }

  const secondSeparatorIndex = value.indexOf(
    MODEL_SELECTION_SEPARATOR,
    firstSeparatorIndex + MODEL_SELECTION_SEPARATOR.length,
  );
  if (secondSeparatorIndex === -1) {
    return null;
  }

  const providerInstanceId = value.slice(0, firstSeparatorIndex);
  const type = value.slice(
    firstSeparatorIndex + MODEL_SELECTION_SEPARATOR.length,
    secondSeparatorIndex,
  );
  const id = value.slice(
    secondSeparatorIndex + MODEL_SELECTION_SEPARATOR.length,
  );

  if (
    !providerInstanceId ||
    !id ||
    (type !== "speech" && type !== "language" && type !== "embedding")
  ) {
    return null;
  }

  return {
    providerInstanceId,
    type,
    id,
  };
}

export function resolveStoredModelSelectionValue<
  T extends {
    providerInstanceId: string;
    type: string;
    id: string;
  },
>(
  models: T[],
  value: string | null | undefined,
  expectedType?: ModelSelectionType,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = parseModelSelectionKey(value);
  if (parsed) {
    if (expectedType && parsed.type !== expectedType) {
      return undefined;
    }

    return models.some(
      (model) =>
        model.providerInstanceId === parsed.providerInstanceId &&
        model.type === parsed.type &&
        model.id === parsed.id,
    )
      ? value
      : undefined;
  }

  const matches = models.filter(
    (model) =>
      model.id === value && (!expectedType || model.type === expectedType),
  );
  if (matches.length !== 1) {
    return undefined;
  }

  return getModelSelectionKey(
    matches[0].providerInstanceId,
    matches[0].type,
    matches[0].id,
  );
}

export function findModelBySelectionValue<
  T extends {
    providerInstanceId: string;
    type: string;
    id: string;
  },
>(models: T[], value: string | null | undefined): T | undefined {
  const resolvedValue = resolveStoredModelSelectionValue(models, value);
  if (!resolvedValue) {
    return undefined;
  }

  const parsed = parseModelSelectionKey(resolvedValue);
  if (!parsed) {
    return undefined;
  }

  return models.find(
    (model) =>
      model.providerInstanceId === parsed.providerInstanceId &&
      model.type === parsed.type &&
      model.id === parsed.id,
  );
}

export function getSpeechModelSelectionKey(modelId: string): string {
  let providerInstanceId: string;
  if (modelId === "amical-cloud") {
    providerInstanceId = getSystemProviderInstanceId(PROVIDER_TYPES.amical);
  } else if (modelId === "openai-whisper") {
    providerInstanceId = getSystemProviderInstanceId(
      PROVIDER_TYPES.openAIWhisper,
    );
  } else {
    providerInstanceId = getSystemProviderInstanceId(
      PROVIDER_TYPES.localWhisper,
    );
  }
  return getModelSelectionKey(providerInstanceId, "speech", modelId);
}

export function getSpeechModelIdFromStoredSelection(
  value: string | null | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = parseModelSelectionKey(value);
  if (!parsed) {
    return value;
  }

  return parsed.type === "speech" ? parsed.id : undefined;
}

export function isAmicalCloudSelectionValue(
  value: string | null | undefined,
): boolean {
  if (!value) {
    return false;
  }

  const parsed = parseModelSelectionKey(value);
  if (!parsed) {
    return value === "amical-cloud";
  }

  return (
    parsed.providerInstanceId ===
      getSystemProviderInstanceId(PROVIDER_TYPES.amical) &&
    parsed.type === "speech" &&
    parsed.id === "amical-cloud"
  );
}
