import * as workflow from "../../entities/review";
import { createReviewExporter } from "../../features/review-export";
import { createReviewImporter } from "../../features/review-import";
import { createImportDialog } from "../../widgets/review-import-dialog";
import { startReviewControls } from "../../widgets/review-dialog";

if (document.querySelector('meta[content="GitLab"], body[data-page]')) {
  const exporter = createReviewExporter();
  const importer = createReviewImporter();
  const importDialog = createImportDialog(() => importer);
  startReviewControls(
    exporter,
    () => workflow,
    () => importer,
    () => importDialog,
  );
}
