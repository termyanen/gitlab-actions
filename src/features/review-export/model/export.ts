import * as defaultWorkflow from "../../../entities/review";
import {
  DEFAULT_FRESH_REVIEW_PROMPT,
  DEFAULT_PROMPT,
} from "../../../entities/review";
import { createReviewContextLoader } from "./context";
import { getNotes, getStatus, load } from "./discussions";
import { createFeedbackExporter } from "./feedback";
import { createFreshReviewExporter } from "./fresh";
import { createRepeatReviewExporter } from "./repeat";
import { loadReviewVersions } from "./revisions";
import { parsePage } from "./route";
import type { ExportOptions } from "./types";
export function createReviewExporter(
  reviewWorkflow: typeof defaultWorkflow | null = defaultWorkflow,
) {
  const { prepareExport } = createFeedbackExporter({
    reviewWorkflow,
    instruction,
  });
  const { prepareReviewContext } = createReviewContextLoader({
    reviewWorkflow,
    instruction,
  });
  const { renderReview, prepareFreshReview } = createFreshReviewExporter(
    { reviewWorkflow, instruction },
    prepareReviewContext,
  );
  const { prepareRepeatReview } = createRepeatReviewExporter(
    { reviewWorkflow, instruction },
    prepareReviewContext,
    renderReview,
  );
  function instruction(
    id: string,
    fallback: string,
    options?: ExportOptions,
    variables?: Record<string, string>,
  ) {
    return reviewWorkflow
      ? reviewWorkflow.instruction(id, options, variables)
      : fallback.replace(
          /\{(language|selection)\}/g,
          function (match: string, key: string) {
            return variables && variables[key] !== undefined
              ? variables[key]
              : match;
          },
        );
  }

  return {
    DEFAULT_PROMPT: DEFAULT_PROMPT,
    DEFAULT_FRESH_REVIEW_PROMPT: DEFAULT_FRESH_REVIEW_PROMPT,
    parsePage: parsePage,
    load: load,
    getNotes: getNotes,
    getStatus: getStatus,
    prepareExport: prepareExport,
    loadReviewVersions: loadReviewVersions,
    prepareRepeatReview: prepareRepeatReview,
    prepareFreshReview: prepareFreshReview,
  };
}
