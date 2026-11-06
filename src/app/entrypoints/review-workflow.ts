import * as workflow from "../../entities/review";

// Compatibility bridge while the remaining UI entrypoints are migrated.
Object.assign(window, { GlReviewWorkflow: workflow });
