import type * as Workflow from "../../../entities/review";
import type { ExportOptions } from "./types";
export interface ExportDependencies {
  reviewWorkflow: typeof Workflow | null;
  instruction: (
    id: string,
    fallback: string,
    options?: ExportOptions,
    variables?: Record<string, string>,
  ) => string;
}
