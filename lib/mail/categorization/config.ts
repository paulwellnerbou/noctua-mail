/**
 * Categorization feature configuration
 *
 * Centralized place to enable/disable email categorization feature.
 * This makes it easy to toggle the feature without touching integration code.
 */

import type { ClassifierConfig } from './classifier';
import { DEFAULT_CONFIG } from './classifier';

/**
 * Feature flag: Enable/disable email categorization globally
 *
 * Set to false to completely disable categorization without removing code.
 */
const CATEGORIZATION_ENABLED = true;

/**
 * Check if categorization feature is enabled
 */
export function isCategorizationEnabled(): boolean {
  return CATEGORIZATION_ENABLED;
}

/**
 * Get categorization configuration
 *
 * Can be extended to read from environment variables or database settings.
 */
export function getCategorizationConfig(): ClassifierConfig {
  if (!CATEGORIZATION_ENABLED) {
    return {
      ...DEFAULT_CONFIG,
      enabled: false,
    };
  }

  // You can override config here or load from environment
  // For example: const minConfidence = parseFloat(process.env.CATEGORY_MIN_CONFIDENCE || '0.7');

  return {
    ...DEFAULT_CONFIG,
    enabled: true,
    minConfidence: 0.7, // Conservative: high confidence required
  };
}

/**
 * Example: Account-specific configuration
 *
 * You could extend this to allow per-account settings in the future:
 *
 * export function getAccountCategorizationConfig(accountId: string): ClassifierConfig {
 *   const accountSettings = getAccountSettings(accountId);
 *   return {
 *     ...DEFAULT_CONFIG,
 *     enabled: accountSettings.categorization?.enabled ?? CATEGORIZATION_ENABLED,
 *     minConfidence: accountSettings.categorization?.minConfidence ?? 0.7,
 *   };
 * }
 */
