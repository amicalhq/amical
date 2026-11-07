import { z } from 'zod';
import { AppsV1IsoDateTimeSchema } from './common.js';

// Older desktop versions send process.platform names (darwin / win32); newer
// versions send macos / windows. Both parse to macos / windows. Mobile sends
// ios / android.
export const RemoteConfigPlatformSchema = z
  .enum(['macos', 'windows', 'linux', 'darwin', 'win32', 'ios', 'android'])
  .transform(platform =>
    platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform
  );
export type RemoteConfigPlatform = z.output<typeof RemoteConfigPlatformSchema>;

export const RemoteConfigQuerySchema = z
  .object({
    platform: RemoteConfigPlatformSchema.optional(),
    version: z.string().optional(),
    locale: z.string().optional(),
  })
  .strip();
export type RemoteConfigQuery = z.output<typeof RemoteConfigQuerySchema>;

export const RemoteConfigCtaSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('open_external_url'),
      label: z.string(),
      url: z.url(),
    })
    .strip(),
  z
    .object({
      action: z.literal('open_route'),
      label: z.string(),
      route: z.string(),
    })
    .strip(),
  z.object({ action: z.literal('dismiss'), label: z.string() }).strip(),
]);
export type RemoteConfigCta = z.output<typeof RemoteConfigCtaSchema>;

export const RemoteConfigContentSchema = z
  .object({
    body: z.string(),
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    icon: z.string().optional(),
    iconUrl: z.url().optional(),
    backgroundImageUrl: z.url().optional(),
  })
  .strip();
export type RemoteConfigContent = z.output<typeof RemoteConfigContentSchema>;

export const RemoteConfigSurfaceSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['banner', 'side_slot']),
    dismissible: z.boolean().optional(),
    reshowAfterDays: z.number().optional(),
    priority: z.number().optional(),
    expiresAt: AppsV1IsoDateTimeSchema.optional(),
    tone: z.enum(['default', 'info', 'warning', 'success']).optional(),
    content: RemoteConfigContentSchema,
    cta: RemoteConfigCtaSchema.optional(),
    secondaryCta: RemoteConfigCtaSchema.optional(),
  })
  .strip();
export type RemoteConfigSurface = z.output<typeof RemoteConfigSurfaceSchema>;

export const UpdateRequirementSchema = z
  .object({
    required: z.boolean(),
    evaluatedVersion: z.string().min(1),
    minimumVersion: z.string().min(1).optional(),
  })
  .strip();
export type UpdateRequirement = z.output<typeof UpdateRequirementSchema>;

export const RemoteConfigResponseSchema = z
  .object({
    version: z.literal(1),
    surfaces: z.array(RemoteConfigSurfaceSchema),
    flags: z.record(z.string(), z.boolean()),
    updateRequirement: UpdateRequirementSchema.optional(),
  })
  .strip();
export type RemoteConfigResponse = z.output<typeof RemoteConfigResponseSchema>;
