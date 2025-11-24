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
  Cloud = "cloud",
  Local = "local",
}

export enum PermissionStatus {
  Granted = "granted",
  Denied = "denied",
  NotDetermined = "not-determined",
  Restricted = "restricted",
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
  selectedModelType?: ModelType;
  modelRecommendation?: ModelRecommendation & { followed: boolean };
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

export interface AnalyticsEvent {
  eventName: string;
  properties: Record<string, any>;
}

// ============================================================================
// Navigation Types
// ============================================================================

export interface NavigationState {
  currentScreen: OnboardingScreen;
  completedScreens: OnboardingScreen[];
  availableScreens: OnboardingScreen[];
  canGoBack: boolean;
  canGoNext: boolean;
}

export interface ScreenTransition {
  from: OnboardingScreen;
  to: OnboardingScreen;
  action: "next" | "back" | "skip";
  timestamp: number;
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
  featureInterests: z.array(FeatureInterestSchema).max(3).optional(),
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
  featureInterests: z.array(FeatureInterestSchema).max(3).optional(),
  discoverySource: DiscoverySourceSchema.optional(),
  selectedModelType: ModelTypeSchema.optional(),
  followedRecommendation: z.boolean().optional(),
});

// ============================================================================
// Type Guards
// ============================================================================

export function isValidOnboardingState(data: unknown): data is OnboardingState {
  return OnboardingStateSchema.safeParse(data).success;
}

export function isValidOnboardingPreferences(
  data: unknown,
): data is OnboardingPreferences {
  return OnboardingPreferencesSchema.safeParse(data).success;
}

export function isSkippableScreen(screen: OnboardingScreen): boolean {
  return (
    screen !== OnboardingScreen.Permissions &&
    screen !== OnboardingScreen.Completion
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

export function getScreenOrder(): OnboardingScreen[] {
  return [
    OnboardingScreen.Welcome,
    OnboardingScreen.Permissions,
    OnboardingScreen.DiscoverySource,
    OnboardingScreen.ModelSelection,
    OnboardingScreen.Completion,
  ];
}

export function getNextScreen(
  current: OnboardingScreen,
  skippedScreens: OnboardingScreen[] = [],
): OnboardingScreen | null {
  const order = getScreenOrder();
  const currentIndex = order.indexOf(current);

  for (let i = currentIndex + 1; i < order.length; i++) {
    const nextScreen = order[i];
    if (!skippedScreens.includes(nextScreen)) {
      return nextScreen;
    }
  }

  return null;
}

export function getPreviousScreen(
  current: OnboardingScreen,
  skippedScreens: OnboardingScreen[] = [],
): OnboardingScreen | null {
  const order = getScreenOrder();
  const currentIndex = order.indexOf(current);

  for (let i = currentIndex - 1; i >= 0; i--) {
    const prevScreen = order[i];
    if (!skippedScreens.includes(prevScreen)) {
      return prevScreen;
    }
  }

  return null;
}

export function calculateProgress(
  currentScreen: OnboardingScreen,
  skippedScreens: OnboardingScreen[] = [],
): { current: number; total: number; percentage: number } {
  const order = getScreenOrder();
  const activeScreens = order.filter((s) => !skippedScreens.includes(s));
  const currentIndex = activeScreens.indexOf(currentScreen) + 1;
  const total = activeScreens.length;

  return {
    current: currentIndex,
    total,
    percentage: Math.round((currentIndex / total) * 100),
  };
}

// ============================================================================
// Display Helpers
// ============================================================================

export const FEATURE_INTEREST_LABELS: Record<FeatureInterest, string> = {
  [FeatureInterest.ContextualDictation]: "Contextual Dictation",
  [FeatureInterest.NoteTaking]: "Note Taking",
  [FeatureInterest.MeetingTranscriptions]: "Meeting Transcriptions",
};

export const DISCOVERY_SOURCE_LABELS: Record<DiscoverySource, string> = {
  [DiscoverySource.SearchEngine]: "Search Engine (Google, Bing, etc.)",
  [DiscoverySource.SocialMedia]: "Social Media (Twitter, LinkedIn, etc.)",
  [DiscoverySource.WordOfMouth]: "Friend or Colleague",
  [DiscoverySource.Advertisement]: "Online Advertisement",
  [DiscoverySource.GitHub]: "GitHub",
  [DiscoverySource.AIAssistant]: "AI Assistant",
  [DiscoverySource.BlogArticle]: "Blog or Article",
  [DiscoverySource.Other]: "Other",
};

export const MODEL_TYPE_LABELS: Record<ModelType, string> = {
  [ModelType.Cloud]: "Cloud Processing",
  [ModelType.Local]: "Local Processing",
};

export const SCREEN_TITLES: Record<OnboardingScreen, string> = {
  [OnboardingScreen.Welcome]: "Welcome to Amical",
  [OnboardingScreen.Permissions]: "Grant Permissions",
  [OnboardingScreen.DiscoverySource]: "How did you find us?",
  [OnboardingScreen.ModelSelection]: "Choose your processing mode",
  [OnboardingScreen.Completion]: "You're all set!",
};
