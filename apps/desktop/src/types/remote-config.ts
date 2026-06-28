// The remote-config contract lives in @amical/types so desktop, native, and www
// all conform to one source of truth (it also feeds that package's JSON-Schema /
// Swift / C# generators). Re-exported here so desktop code keeps importing from
// "@/types/remote-config".
export {
  DEFAULT_RESHOW_AFTER_DAYS,
  RemoteConfigSchema,
  RemoteConfigSurfaceSchema,
  RemoteConfigContentSchema,
  RemoteConfigCtaSchema,
  RemoteConfigToneSchema,
} from "@amical/types";
export type {
  RemoteConfig,
  RemoteConfigSurface,
  RemoteConfigBannerSurface,
  RemoteConfigSideSlotSurface,
  RemoteConfigContent,
  RemoteConfigCta,
  RemoteConfigIconName,
  RemoteConfigTone,
} from "@amical/types";
