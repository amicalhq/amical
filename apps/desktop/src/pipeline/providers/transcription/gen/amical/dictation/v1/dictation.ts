// @generated from apps/desktop/proto/amical/dictation/v1/dictation.proto by protobufjs. Do not edit manually.

import { Enum, Root, Service, Type } from "protobufjs";

const descriptor = {
  nested: {
    amical: {
      nested: {
        dictation: {
          nested: {
            v1: {
              nested: {
                DictationService: {
                  methods: {
                    StreamTranscribe: {
                      requestType: "StreamTranscribeRequest",
                      requestStream: true,
                      responseType: "StreamTranscribeEvent",
                      responseStream: true,
                    },
                  },
                },
                AudioEncoding: {
                  values: {
                    AUDIO_ENCODING_UNSPECIFIED: 0,
                    AUDIO_ENCODING_PCM_S16LE: 1,
                    AUDIO_ENCODING_OPUS: 2,
                  },
                },
                AudioConfig: {
                  fields: {
                    encoding: {
                      type: "AudioEncoding",
                      id: 1,
                    },
                    packetDurationMs: {
                      type: "uint32",
                      id: 2,
                    },
                  },
                },
                StreamContext: {
                  fields: {
                    selectedText: {
                      type: "string",
                      id: 1,
                    },
                    beforeText: {
                      type: "string",
                      id: 2,
                    },
                    afterText: {
                      type: "string",
                      id: 3,
                    },
                    appType: {
                      type: "string",
                      id: 4,
                    },
                    appBundleId: {
                      type: "string",
                      id: 5,
                    },
                    appName: {
                      type: "string",
                      id: 6,
                    },
                    appUrl: {
                      type: "string",
                      id: 7,
                    },
                  },
                },
                AutoLanguage: {
                  fields: {},
                },
                Language: {
                  values: {
                    LANGUAGE_UNSPECIFIED: 0,
                    LANGUAGE_EN: 1,
                    LANGUAGE_ZH: 2,
                    LANGUAGE_ES: 3,
                    LANGUAGE_AF: 4,
                    LANGUAGE_SQ: 5,
                    LANGUAGE_AM: 6,
                    LANGUAGE_AR: 7,
                    LANGUAGE_HY: 8,
                    LANGUAGE_AS: 9,
                    LANGUAGE_AZ: 10,
                    LANGUAGE_BA: 11,
                    LANGUAGE_EU: 12,
                    LANGUAGE_BE: 13,
                    LANGUAGE_BN: 14,
                    LANGUAGE_BS: 15,
                    LANGUAGE_BR: 16,
                    LANGUAGE_BG: 17,
                    LANGUAGE_CA: 18,
                    LANGUAGE_HR: 19,
                    LANGUAGE_CS: 20,
                    LANGUAGE_DA: 21,
                    LANGUAGE_NL: 22,
                    LANGUAGE_ET: 23,
                    LANGUAGE_FO: 24,
                    LANGUAGE_FI: 25,
                    LANGUAGE_FR: 26,
                    LANGUAGE_GL: 27,
                    LANGUAGE_KA: 28,
                    LANGUAGE_DE: 29,
                    LANGUAGE_EL: 30,
                    LANGUAGE_GU: 31,
                    LANGUAGE_HT: 32,
                    LANGUAGE_HA: 33,
                    LANGUAGE_HAW: 34,
                    LANGUAGE_HE: 35,
                    LANGUAGE_HI: 36,
                    LANGUAGE_HU: 37,
                    LANGUAGE_IS: 38,
                    LANGUAGE_ID: 39,
                    LANGUAGE_IT: 40,
                    LANGUAGE_JA: 41,
                    LANGUAGE_JW: 42,
                    LANGUAGE_KN: 43,
                    LANGUAGE_KK: 44,
                    LANGUAGE_KM: 45,
                    LANGUAGE_KO: 46,
                    LANGUAGE_LO: 47,
                    LANGUAGE_LA: 48,
                    LANGUAGE_LV: 49,
                    LANGUAGE_LN: 50,
                    LANGUAGE_LT: 51,
                    LANGUAGE_LB: 52,
                    LANGUAGE_MK: 53,
                    LANGUAGE_MG: 54,
                    LANGUAGE_MS: 55,
                    LANGUAGE_ML: 56,
                    LANGUAGE_MT: 57,
                    LANGUAGE_MI: 58,
                    LANGUAGE_MR: 59,
                    LANGUAGE_MN: 60,
                    LANGUAGE_MY: 61,
                    LANGUAGE_NE: 62,
                    LANGUAGE_NO: 63,
                    LANGUAGE_NN: 64,
                    LANGUAGE_OC: 65,
                    LANGUAGE_PS: 66,
                    LANGUAGE_FA: 67,
                    LANGUAGE_PL: 68,
                    LANGUAGE_PT: 69,
                    LANGUAGE_PA: 70,
                    LANGUAGE_RO: 71,
                    LANGUAGE_RU: 72,
                    LANGUAGE_SA: 73,
                    LANGUAGE_SR: 74,
                    LANGUAGE_SN: 75,
                    LANGUAGE_SD: 76,
                    LANGUAGE_SI: 77,
                    LANGUAGE_SK: 78,
                    LANGUAGE_SL: 79,
                    LANGUAGE_SO: 80,
                    LANGUAGE_SU: 81,
                    LANGUAGE_SW: 82,
                    LANGUAGE_SV: 83,
                    LANGUAGE_TL: 84,
                    LANGUAGE_TG: 85,
                    LANGUAGE_TA: 86,
                    LANGUAGE_TT: 87,
                    LANGUAGE_TE: 88,
                    LANGUAGE_TH: 89,
                    LANGUAGE_BO: 90,
                    LANGUAGE_TR: 91,
                    LANGUAGE_TK: 92,
                    LANGUAGE_UK: 93,
                    LANGUAGE_UR: 94,
                    LANGUAGE_UZ: 95,
                    LANGUAGE_VI: 96,
                    LANGUAGE_CY: 97,
                    LANGUAGE_YI: 98,
                    LANGUAGE_YO: 99,
                  },
                },
                LanguageList: {
                  fields: {
                    items: {
                      rule: "repeated",
                      type: "Language",
                      id: 1,
                    },
                  },
                },
                StreamLanguageConfig: {
                  oneofs: {
                    mode: {
                      oneof: ["auto", "languages"],
                    },
                  },
                  fields: {
                    auto: {
                      type: "AutoLanguage",
                      id: 1,
                    },
                    languages: {
                      type: "LanguageList",
                      id: 2,
                    },
                  },
                },
                StreamOpen: {
                  oneofs: {
                    _formatting: {
                      oneof: ["formatting"],
                    },
                  },
                  fields: {
                    sessionId: {
                      type: "string",
                      id: 1,
                    },
                    audioConfig: {
                      type: "AudioConfig",
                      id: 2,
                    },
                    language: {
                      type: "StreamLanguageConfig",
                      id: 3,
                    },
                    vocabulary: {
                      rule: "repeated",
                      type: "string",
                      id: 4,
                    },
                    formatting: {
                      type: "bool",
                      id: 5,
                      options: {
                        proto3_optional: true,
                      },
                    },
                  },
                },
                StreamContextUpdate: {
                  fields: {
                    context: {
                      type: "StreamContext",
                      id: 1,
                    },
                  },
                },
                StreamAudioBatch: {
                  fields: {
                    firstSeq: {
                      type: "uint64",
                      id: 1,
                    },
                    chunks: {
                      rule: "repeated",
                      type: "bytes",
                      id: 2,
                    },
                  },
                },
                StreamFinalize: {
                  fields: {},
                },
                StreamCancelCode: {
                  values: {
                    STREAM_CANCEL_CODE_UNSPECIFIED: 0,
                    STREAM_CANCEL_CODE_USER_ABORTED: 1,
                  },
                },
                StreamCancel: {
                  oneofs: {
                    _code: {
                      oneof: ["code"],
                    },
                  },
                  fields: {
                    code: {
                      type: "StreamCancelCode",
                      id: 1,
                      options: {
                        proto3_optional: true,
                      },
                    },
                  },
                },
                StreamTranscribeRequest: {
                  oneofs: {
                    payload: {
                      oneof: [
                        "open",
                        "contextUpdate",
                        "audio",
                        "finalize",
                        "cancel",
                      ],
                    },
                  },
                  fields: {
                    open: {
                      type: "StreamOpen",
                      id: 1,
                    },
                    contextUpdate: {
                      type: "StreamContextUpdate",
                      id: 2,
                    },
                    audio: {
                      type: "StreamAudioBatch",
                      id: 3,
                    },
                    finalize: {
                      type: "StreamFinalize",
                      id: 4,
                    },
                    cancel: {
                      type: "StreamCancel",
                      id: 5,
                    },
                  },
                },
                StreamStatus: {
                  fields: {
                    sessionId: {
                      type: "string",
                      id: 1,
                    },
                    acceptedThroughSeq: {
                      type: "uint64",
                      id: 2,
                    },
                  },
                },
                FinalTranscript: {
                  fields: {
                    rawTranscript: {
                      type: "string",
                      id: 1,
                    },
                    formattedTranscript: {
                      type: "string",
                      id: 2,
                    },
                    throughSeq: {
                      type: "uint64",
                      id: 3,
                    },
                  },
                },
                StreamTranscribeEvent: {
                  oneofs: {
                    payload: {
                      oneof: ["status", "final"],
                    },
                  },
                  fields: {
                    status: {
                      type: "StreamStatus",
                      id: 1,
                    },
                    final: {
                      type: "FinalTranscript",
                      id: 2,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as unknown as Parameters<typeof Root.fromJSON>[0];

const root = Root.fromJSON(descriptor);

const lookupType = (name: string): Type => root.lookupType(name);
const lookupEnum = (name: string): Enum => root.lookupEnum(name);
const lookupService = (name: string): Service => root.lookupService(name);

export const AudioConfig = lookupType("amical.dictation.v1.AudioConfig");
export const StreamContext = lookupType("amical.dictation.v1.StreamContext");
export const AutoLanguage = lookupType("amical.dictation.v1.AutoLanguage");
export const LanguageList = lookupType("amical.dictation.v1.LanguageList");
export const StreamLanguageConfig = lookupType(
  "amical.dictation.v1.StreamLanguageConfig",
);
export const StreamOpen = lookupType("amical.dictation.v1.StreamOpen");
export const StreamContextUpdate = lookupType(
  "amical.dictation.v1.StreamContextUpdate",
);
export const StreamAudioBatch = lookupType(
  "amical.dictation.v1.StreamAudioBatch",
);
export const StreamFinalize = lookupType("amical.dictation.v1.StreamFinalize");
export const StreamCancel = lookupType("amical.dictation.v1.StreamCancel");
export const StreamTranscribeRequest = lookupType(
  "amical.dictation.v1.StreamTranscribeRequest",
);
export const StreamStatus = lookupType("amical.dictation.v1.StreamStatus");
export const FinalTranscript = lookupType(
  "amical.dictation.v1.FinalTranscript",
);
export const StreamTranscribeEvent = lookupType(
  "amical.dictation.v1.StreamTranscribeEvent",
);

export const AudioEncoding = lookupEnum("amical.dictation.v1.AudioEncoding");
export const Language = lookupEnum("amical.dictation.v1.Language");
export const StreamCancelCode = lookupEnum(
  "amical.dictation.v1.StreamCancelCode",
);

export const DictationService = lookupService(
  "amical.dictation.v1.DictationService",
);

const streamTranscribeMethod = DictationService.methodsArray[0];
if (!streamTranscribeMethod) {
  throw new Error("DictationService has no StreamTranscribe method");
}

export const STREAM_TRANSCRIBE_PATH =
  "/" +
  DictationService.fullName.replace(/^\./, "") +
  "/" +
  streamTranscribeMethod.name;
