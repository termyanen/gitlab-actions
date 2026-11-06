import { createTaskTracker } from "../../widgets/task-tracker";
import { startMrToolbar } from "../../widgets/mr-toolbar";

window.__glMrActionsLoaded = true;
const toolbar = startMrToolbar(
  {
    origin: window.location.origin,
    projectId: null,
    mrIid: null,
    projectPath: null,
  },
  createTaskTracker(),
);
window.__glMrPaletteRun = toolbar.runPaletteAction;
