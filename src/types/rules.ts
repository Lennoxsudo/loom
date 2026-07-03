/**
 * Rules configuration type definitions
 */

/**
 * A single rule item
 */
export interface RuleItem {
  /** Unique identifier (UUID) */
  id: string;
  /** Rule name */
  name: string;
  /** Rule content */
  content: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

/**
 * Rules configuration for persistence (Chat Rules + Templates)
 */
export interface RulesConfig {
  /** Rules for regular AI chat */
  chatRules: RuleItem[];
  /** Reusable rules templates */
  rulesTemplates: RuleItem[];
}
