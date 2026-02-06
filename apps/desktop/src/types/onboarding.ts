/**
 * Type definitions for Enhanced Onboarding Flow
 * These types are used throughout the onboarding implementation
 */

import { z } from "zod";

// ============================================================================
// Enumerations
// ============================================================================

export enum OnboardingScreen {
  Welcome = "welcome",
  Permissions = "permissions",
  DiscoverySource = "discovery",
  ModelSelection = "models",
  Completion = "completion",
}

export enum FeatureInterest {
  ContextualDictation = "contextual_dictation",
  NoteTaking = "note_taking",
  MeetingTranscriptions = "meeting_transcriptions",
  VoiceCommands = "voice_commands",
}

export enum DiscoverySource {
  SearchEngine = "search_engine",
  SocialMedia = "social_media",
  WordOfMouth = "word_of_mouth",
  Advertisement = "advertisement",
  GitHub = "github",
  AIAssistant = "ai_assistant",
  BlogArticle = "blog_article",
  Other = "other",
}

export enum ModelType {
  Local = "local",
}

// ============================================================================
// Data Types
// ============================================================================

export interface SystemSpecs {
  cpu_model?: string;
  cpu_cores: number;
  cpu_threads: number;
  cpu_speed_ghz: number;
  memory_total_gb: number;
  gpu_model?: string;
  gpu_vendor?: string;
}

export interface ModelRecommendation {
  suggested: ModelType;
  reason: string;
  systemSpecs?: Partial<SystemSpecs>;
}

export interface OnboardingPreferences {
  featureInterests?: FeatureInterest[];
  discoverySource?: DiscoverySource;
  discoveryDetails?: string;
  selectedModelType?: ModelType;
  modelRecommendation?: ModelRecommendation & { followed: boolean };
  lastVisitedScreen?: OnboardingScreen;
}

export interface OnboardingState {
  completedVersion: number;
  completedAt: string;
  lastVisitedScreen?: OnboardingScreen;
  skippedScreens?: OnboardingScreen[];
  featureInterests?: FeatureInterest[];
  discoverySource?: DiscoverySource;
  selectedModelType: ModelType;
  modelRecommendation?: {
    suggested: ModelType;
    reason: string;
    followed: boolean;
  };
}

// ============================================================================
// Feature Flags
// ============================================================================

export interface OnboardingFeatureFlags {
  skipWelcome: boolean;
  skipFeatures: boolean;
  skipDiscovery: boolean;
  skipModels: boolean;
}

// ============================================================================
// Zod Validation Schemas
// ============================================================================

export const FeatureInterestSchema = z.nativeEnum(FeatureInterest);

export const DiscoverySourceSchema = z.nativeEnum(DiscoverySource);

export const ModelTypeSchema = z.nativeEnum(ModelType);

export const OnboardingScreenSchema = z.nativeEnum(OnboardingScreen);

export const OnboardingStateSchema = z.object({
  completedVersion: z.number().min(1),
  completedAt: z.string().datetime(),
  skippedScreens: z.array(OnboardingScreenSchema).optional(),
  featureInterests: z.array(FeatureInterestSchema).optional(),
  discoverySource: DiscoverySourceSchema.optional(),
  selectedModelType: ModelTypeSchema,
  modelRecommendation: z
    .object({
      suggested: ModelTypeSchema,
      reason: z.string().min(1),
      followed: z.boolean(),
    })
    .optional(),
});

export const OnboardingPreferencesSchema = z.object({
  featureInterests: z.array(FeatureInterestSchema).optional(),
  discoverySource: DiscoverySourceSchema.optional(),
  discoveryDetails: z.string().max(200).optional(),
  selectedModelType: ModelTypeSchema.optional(),
  modelRecommendation: z
    .object({
      suggested: ModelTypeSchema,
      reason: z.string(),
      followed: z.boolean(),
    })
    .optional(),
  lastVisitedScreen: OnboardingScreenSchema.optional(),
});
