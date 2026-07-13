import type { Metadata } from "@grpc/grpc-js";
import { Root, type Type } from "protobufjs";

const GRPC_STATUS_DETAILS_HEADER = "grpc-status-details-bin";
const DICTATION_ERROR_DOMAIN = "dictation.amical.ai";

const root = Root.fromJSON({
  nested: {
    google: {
      nested: {
        protobuf: {
          nested: {
            Any: {
              fields: {
                typeUrl: { type: "string", id: 1 },
                value: { type: "bytes", id: 2 },
              },
            },
          },
        },
        rpc: {
          nested: {
            Status: {
              fields: {
                code: { type: "int32", id: 1 },
                message: { type: "string", id: 2 },
                details: {
                  rule: "repeated",
                  type: "google.protobuf.Any",
                  id: 3,
                },
              },
            },
            ErrorInfo: {
              fields: {
                reason: { type: "string", id: 1 },
                domain: { type: "string", id: 2 },
                metadata: {
                  keyType: "string",
                  type: "string",
                  id: 3,
                },
              },
            },
            LocalizedMessage: {
              fields: {
                locale: { type: "string", id: 1 },
                message: { type: "string", id: 2 },
              },
            },
          },
        },
      },
    },
  },
} as unknown as Parameters<typeof Root.fromJSON>[0]);

const statusType = root.lookupType("google.rpc.Status");
const errorInfoType = root.lookupType("google.rpc.ErrorInfo");
const localizedMessageType = root.lookupType("google.rpc.LocalizedMessage");

interface AnyDetail {
  typeUrl?: string;
  value?: Uint8Array;
}

interface RichStatus {
  details?: AnyDetail[];
}

interface ErrorInfoDetail {
  reason?: string;
  domain?: string;
  metadata?: Record<string, string>;
}

interface LocalizedMessageDetail {
  locale?: string;
  message?: string;
}

export interface GrpcRichErrorDetails {
  applicationCode?: string;
  locale?: string;
  localizedMessage?: string;
}

const typeName = (typeUrl: string | undefined): string | undefined =>
  typeUrl?.split("/").at(-1);

const decode = <T>(
  type: Type,
  value: Uint8Array | undefined,
): T | undefined => {
  if (!value) return undefined;
  return type.toObject(type.decode(value), {
    bytes: Uint8Array,
    defaults: false,
    objects: true,
  }) as T;
};

const firstBinaryMetadataValue = (
  metadata: Metadata | undefined,
): Uint8Array | undefined => {
  const value = metadata?.get(GRPC_STATUS_DETAILS_HEADER)[0];
  if (Buffer.isBuffer(value)) return value;
  return undefined;
};

export const decodeGrpcRichErrorDetails = (
  metadata: Metadata | undefined,
): GrpcRichErrorDetails => {
  try {
    const status = decode<RichStatus>(
      statusType,
      firstBinaryMetadataValue(metadata),
    );
    let result: GrpcRichErrorDetails = {};

    for (const detail of status?.details ?? []) {
      switch (typeName(detail.typeUrl)) {
        case "google.rpc.ErrorInfo": {
          const errorInfo = decode<ErrorInfoDetail>(
            errorInfoType,
            detail.value,
          );
          if (
            errorInfo?.domain === DICTATION_ERROR_DOMAIN &&
            errorInfo.reason
          ) {
            result = {
              ...result,
              applicationCode: errorInfo.reason,
            };
          }
          break;
        }
        case "google.rpc.LocalizedMessage": {
          const localized = decode<LocalizedMessageDetail>(
            localizedMessageType,
            detail.value,
          );
          if (localized?.message) {
            result = {
              ...result,
              locale: localized.locale,
              localizedMessage: localized.message,
            };
          }
          break;
        }
      }
    }

    return result.applicationCode ? result : {};
  } catch {
    return {};
  }
};
