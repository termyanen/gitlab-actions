export const SEL = {
  // MR list items
  mrItem:
    '[data-testid="issuable-item-wrapper"], .merge-request, li.issue, [data-testid="issuable-container"] > li, .issuable-list > li',
  // Title link inside MR list item
  titleLink:
    '[data-testid="issuable-title-link"], [data-testid="issuable-title"] a, .issue-title-text a, .merge-request-title-text a',
  // Title container (wraps the title link)
  titleWrap:
    '[data-testid="issuable-title"], .issue-title-text, .merge-request-title-text',
  // Author link inside MR list item
  authorLink:
    '[data-testid="issuable-author"] a, .issuable-authored a.author-link, .author a',
  // Controls bar (ul) inside MR list item
  controls: 'ul.controls, [data-testid="issuable-controls"]',
  // Comments indicator inside controls
  comments: '[data-testid="issuable-comments"], .issuable-comments',
  // Filter/search bar container on list page
  filterBar:
    '.filter-dropdown-container, .vue-filtered-search-bar-container, [data-testid="filtered-search-input"], .gl-search-box-by-type',
  // List container for MutationObserver
  listContainer:
    '[data-testid="issuable-list"], [data-testid="issuable-container"], .issuable-list, .merge-requests-holder, .content-list',
  // Issuable info (metadata row below title: author, dates, etc.)
  issuableInfo:
    '[data-testid="issuable-info"], .issuable-info, .issuable-meta, .issuable-authored',
  // Commit page: SHA button group
  commitShaGroup: ".commit-sha-group, .commit-actions .btn-group",
  // Commit page: SHA element with hash value
  commitSha: "[data-clipboard-text], .label-monospace, .commit-sha",
  // Commit page: row/container for a single commit
  commitRow:
    '.commit, [data-testid="commit-item"], li.commit-header, li[data-testid], .commit-content',
  // Commit page: commit message element
  commitMsg: ".commit-row-message, .item-title, .commit-title",
  // Pipeline graph: stage column root (title + job list)
  pipelineStageColumn: '[data-testid="stage-column"], .stage-column',
  // Pipeline graph: stage column title bar (holds stage name + native action button)
  pipelineStageTitle: '[data-testid="stage-column-title"], .stage-column-title',
  // Pipeline graph: links to job pages inside a stage column (used to map a
  // stage column to the pipeline — parent or child — its jobs belong to)
  pipelineJobLink: 'a[href*="/-/jobs/"], a[href*="/builds/"]',
  // Pipeline graph: native stage action button ("Run all manual") — when present, we skip
  pipelineStageAction:
    '[data-testid="ci-action-button"], .js-stage-action, .js-ci-action',
  // Pipeline graph: root container (for MutationObserver)
  pipelineGraph:
    '[data-testid="pipeline-graph"], .js-pipeline-graph, .pipeline-graph, [data-testid="pipeline-tabs"]',
  // Pipeline graph: expanded upstream/downstream (child) pipeline graph wrapper —
  // stages inside belong to a different pipeline id, skip them
  pipelineLinkedGraph:
    '.pipeline-show-container, .linked-pipelines-column, [data-testid="linked-pipeline-container"]',
};
