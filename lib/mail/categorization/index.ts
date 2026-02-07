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
  classifyEmail,
  getCategoryLabel,
  getCategoryIcon,
  DEFAULT_CONFIG,
  type EmailCategory,
  type ClassificationResult,
  type ClassifierConfig,
} from './classifier';

export { isCategorizationEnabled, getCategorizationConfig } from './config';
