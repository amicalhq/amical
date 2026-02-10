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

export interface OnboardingPreferences {
  discoverySource?: DiscoverySource;
  discoveryDetails?: string;
  lastVisitedScreen?: OnboardingScreen;
}

export interface OnboardingState {
  completedVersion: number;
  completedAt: string;
  lastVisitedScreen?: OnboardingScreen;
  skippedScreens?: OnboardingScreen[];
  discoverySource?: DiscoverySource;
}

// ============================================================================
// Zod Validation Schemas
// ============================================================================

export const DiscoverySourceSchema = z.nativeEnum(DiscoverySource);

export const OnboardingScreenSchema = z.nativeEnum(OnboardingScreen);

export const OnboardingStateSchema = z.object({
  completedVersion: z.number().min(1),
  completedAt: z.string().datetime(),
  skippedScreens: z.array(OnboardingScreenSchema).optional(),
  discoverySource: DiscoverySourceSchema.optional(),
});

export const OnboardingPreferencesSchema = z.object({
  discoverySource: DiscoverySourceSchema.optional(),
  discoveryDetails: z.string().max(200).optional(),
  lastVisitedScreen: OnboardingScreenSchema.optional(),
});
