import * as workflow from "../../entities/review";
import type { createReviewExporter } from "../../features/review-export";
import {
  getNotes,
  getStatus,
  parsePage,
} from "../../features/review-export/content";
import type { createReviewImporter } from "../../features/review-import";
import { errorMessage } from "../../shared/lib/errors";
import { startReviewControls } from "../../widgets/review-dialog";
import type { createImportDialog } from "../../widgets/review-import-dialog";

export function startReview() {
  let exportPromise:
    Promise<ReturnType<typeof createReviewExporter>> | undefined;
  let importPromise:
    Promise<ReturnType<typeof createReviewImporter>> | undefined;
  const exporter = () =>
    (exportPromise ||= import("../../features/review-export").then((module) =>
      module.createReviewExporter(),
    ));
  const importer = () =>
    (importPromise ||= import("../../features/review-import").then((module) =>
      module.createReviewImporter(),
    ));
  type Exporter = ReturnType<typeof createReviewExporter>;
  const data: Exporter = {
    DEFAULT_PROMPT: workflow.DEFAULT_PROMPT,
    DEFAULT_FRESH_REVIEW_PROMPT: workflow.DEFAULT_FRESH_REVIEW_PROMPT,
    parsePage,
    getNotes,
    getStatus,
    load: (...args) => exporter().then((module) => module.load(...args)),
    prepareExport: (...args) =>
      exporter().then((module) => module.prepareExport(...args)),
    loadReviewVersions: (...args) =>
      exporter().then((module) => module.loadReviewVersions(...args)),
    prepareRepeatReview: (...args) =>
      exporter().then((module) => module.prepareRepeatReview(...args)),
    prepareFreshReview: (...args) =>
      exporter().then((module) => module.prepareFreshReview(...args)),
  };
  let dialog: ReturnType<typeof createImportDialog> | undefined;
  let generation = 0;
  const lazyDialog = {
    syncRoute() {
      dialog?.syncRoute();
    },
    close(force?: boolean) {
      generation++;
      return dialog ? dialog.close(force) : true;
    },
    open(...args: Parameters<ReturnType<typeof createImportDialog>["open"]>) {
      const current = ++generation;
      void Promise.all([
        import("../../widgets/review-import-dialog"),
        importer(),
      ])
        .then(([module, model]) => {
          if (generation !== current) return;
          dialog ||= module.createImportDialog(() => model);
          dialog.open(...args);
        })
        .catch((error: unknown) => {
          if (generation === current)
            window.alert(
              String(error instanceof Error ? errorMessage(error) : error),
            );
        });
    },
  };
  const reply = {
    DEFAULT_REPLY_PROMPT: workflow.DEFAULT_REPLY_PROMPT,
    getReplyPrompt: (
      ...args: Parameters<
        ReturnType<typeof createReviewImporter>["getReplyPrompt"]
      >
    ) => importer().then((model) => model.getReplyPrompt(...args)),
  };
  const dispose = startReviewControls(
    data,
    () => workflow,
    () => reply,
    () => lazyDialog,
  );
  return () => {
    generation++;
    dispose?.();
    dialog?.dispose();
  };
}
