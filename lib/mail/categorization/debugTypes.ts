export type CategoryKey = "newsletter" | "notification" | "transactional";

export type CategoryTopWeight = {
  feature: string;
  weight: number;
};

export type CategoryModelSummary = {
  version: string;
  updatedAt: number;
  examples: number;
  learningRate: number;
  l2: number;
  bias: Record<CategoryKey, number>;
  featureCounts: Record<CategoryKey, number>;
  topWeights: Record<CategoryKey, CategoryTopWeight[]>;
};

export type CategoryFeedbackEventSummary = {
  messageId: string;
  previousCategory: CategoryKey | null;
  nextCategory: CategoryKey | null;
  createdAt: number;
  featureCount: number;
};

export type CategoryFeedbackTransitionSummary = {
  previousCategory: CategoryKey | null;
  nextCategory: CategoryKey | null;
  count: number;
};

export type CategoryCountSummary = {
  category: CategoryKey | "uncategorized";
  count: number;
};

export type CategoryLearningDebugSnapshot = {
  model: CategoryModelSummary | null;
  feedback: {
    totalEvents: number;
    lastEventAt: number | null;
    transitions: CategoryFeedbackTransitionSummary[];
    recent: CategoryFeedbackEventSummary[];
  };
  categoryCounts: CategoryCountSummary[];
  manualCategorizedCount: number;
};
