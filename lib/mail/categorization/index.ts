/**
 * Email categorization module
 *
 * Provides automatic classification of emails into categories:
 * - Newsletters
 * - Marketing
 * - Notifications
 * - Transactional
 *
 * This module is designed to be easily enabled/disabled via feature flags.
 */

export {
  classifyCategoryFromMetadata,
  parseMailForCategorization,
  CATEGORY_SOURCE_PARSE_OPTIONS,
  getCategoryLabel,
  getCategoryIcon,
  DEFAULT_CONFIG,
  type EmailCategory,
  type ClassificationResult,
  type ClassifierConfig,
  type CategoryClassificationInput,
  type ClassifyCategoryOptions,
} from './classifier';

export {
  CATEGORY_KEYS,
  createDefaultLinearModel,
  createSeededLinearModel,
  extractLinearFeatures,
  applyLinearModel,
  trainLinearModelPositive,
  trainLinearModelNegative,
  type CategoryKey,
  type CategoryLinearModel,
  type CategoryScores,
  type LinearFeatureEmailInput,
  type LinearFeatureVector,
} from "./linearModel";

export { isCategorizationEnabled, getCategorizationConfig } from './config';
