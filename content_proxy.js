'use strict';

// Proxy + tracker script — injected on ALL https pages.
// Handles: API proxy for background worker, background jobs tracker panel.
// Full UI (buttons, actions) lives in content.js (MR pages only).

(function() {
  var _isMrDetailPage = !!window.__glMrActionsLoaded;

  function isGitLab() {
    return !!document.querySelector('meta[content="GitLab"]') || !!document.querySelector('body[data-page]');
  }

  if (!isGitLab()) return;

  // =========================================================================
  // Centralized DOM selectors — cross-version GitLab compatibility
  // When GitLab changes DOM, update selectors HERE (one place).
  // Order matters: preferred (newest) selectors first, legacy last.
  // =========================================================================
  var SEL = {
    // MR list items
    mrItem: '[data-testid="issuable-item-wrapper"], .merge-request, li.issue, [data-testid="issuable-container"] > li, .issuable-list > li',
    // Title link inside MR list item
    titleLink: '[data-testid="issuable-title-link"], [data-testid="issuable-title"] a, .issue-title-text a, .merge-request-title-text a',
    // Title container (wraps the title link)
    titleWrap: '[data-testid="issuable-title"], .issue-title-text, .merge-request-title-text',
    // Author link inside MR list item
    authorLink: '[data-testid="issuable-author"] a, .issuable-authored a.author-link, .author a',
    // Controls bar (ul) inside MR list item
    controls: 'ul.controls, [data-testid="issuable-controls"]',
    // Comments indicator inside controls
    comments: '[data-testid="issuable-comments"], .issuable-comments',
    // Filter/search bar container on list page
    filterBar: '.filter-dropdown-container, .vue-filtered-search-bar-container, [data-testid="filtered-search-input"], .gl-search-box-by-type',
    // List container for MutationObserver
    listContainer: '[data-testid="issuable-list"], [data-testid="issuable-container"], .issuable-list, .merge-requests-holder, .content-list',
    // Issuable info (metadata row below title: author, dates, etc.)
    issuableInfo: '[data-testid="issuable-info"], .issuable-info, .issuable-meta, .issuable-authored',
    // Commit page: SHA button group
    commitShaGroup: '.commit-sha-group, .commit-actions .btn-group',
    // Commit page: SHA element with hash value
    commitSha: '[data-clipboard-text], .label-monospace, .commit-sha',
    // Commit page: row/container for a single commit
    commitRow: '.commit, [data-testid="commit-item"], .commit-content, li',
    // Commit page: commit message element
    commitMsg: '.commit-row-message, .item-title a, .commit-title'
  };

  // Try querySelector against a multi-selector string; returns first match or null.
  // If parent is null/undefined, returns null safely.
  function q(parent, selectorStr) {
    if (!parent) return null;
    try { return parent.querySelector(selectorStr); } catch(e) { return null; }
  }

  // Try querySelectorAll; returns NodeList (possibly empty).
  function qAll(parent, selectorStr) {
    if (!parent) return [];
    try { return parent.querySelectorAll(selectorStr); } catch(e) { return []; }
  }

  // Find the closest ancestor matching any selector in a comma-separated string
  function qUp(el, selectorStr) {
    if (!el) return null;
    try { return el.closest(selectorStr); } catch(e) { return null; }
  }

  // Safely insert newNode after refNode inside container.
  // Handles case where refNode is nested deeper inside container (not a direct child).
  function insertAfterSafe(container, newNode, refNode) {
    if (!container || !newNode) return;
    if (!refNode) { container.appendChild(newNode); return; }
    // If refNode is a direct child of container, use insertBefore on nextSibling
    if (refNode.parentNode === container) {
      if (refNode.nextSibling) {
        container.insertBefore(newNode, refNode.nextSibling);
      } else {
        container.appendChild(newNode);
      }
    } else {
      // refNode is nested deeper — append to container end
      container.appendChild(newNode);
    }
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getPriorityHtml(name, iconUrl) {
    if (!name) return '';
    var icon = iconUrl ? '<img class="gl-jira-priority-icon" src="' + escHtml(iconUrl) + '" alt="">' : '';
    return '<span class="gl-jira-priority">' + icon + escHtml(name) + '</span>';
  }

  var GITLAB_URL = window.location.origin;

  function getCsrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function api(method, path, body) {
    var url = GITLAB_URL + '/api/v4' + path;
    var headers = { 'Content-Type': 'application/json' };
    if (method !== 'GET') {
      headers['X-CSRF-Token'] = getCsrfToken();
    }
    var opts = {
      method: method,
      headers: headers,
      credentials: 'same-origin',
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function(r) {
      if (r.status === 204) return {};
      return r.text().then(function(text) {
        var data;
        try { data = JSON.parse(text); } catch(e) { data = null; }
        if (!r.ok) {
          var msg = (data && (data.message || data.error)) || (r.status + ' ' + r.statusText);
          if (typeof msg === 'object') msg = JSON.stringify(msg);
          throw new Error(msg);
        }
        return data || {};
      });
    });
  }

  // =========================================================================
  // Background jobs tracker panel (same as in content.js)
  // =========================================================================

  function getTrackerFab() {
    var fab = document.querySelector('.gl-mr-actions-fab');
    if (fab) return fab;

    fab = document.createElement('button');
    fab.className = 'gl-mr-actions-fab';
    fab.textContent = 'Jobs';
    fab.addEventListener('click', function() {
      var panel = document.querySelector('.gl-mr-actions-tracker');
      if (panel) {
        panel.classList.remove('tracker-collapsed');
        fab.classList.remove('fab-visible');
      }
    });
    document.body.appendChild(fab);
    return fab;
  }

  function getTrackerPanel() {
    var panel = document.querySelector('.gl-mr-actions-tracker');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.className = 'gl-mr-actions-tracker';

    var header = document.createElement('div');
    header.className = 'tracker-header';
    header.innerHTML = '<span class="tracker-title">Background Jobs</span><div class="tracker-header-actions"><button class="tracker-clear">Clear</button><button class="tracker-close" aria-label="Close">&times;</button></div>';
    header.querySelector('.tracker-close').addEventListener('click', function() {
      panel.classList.add('tracker-collapsed');
      getTrackerFab().classList.add('fab-visible');
    });
    header.querySelector('.tracker-clear').addEventListener('click', function() {
      var items = panel.querySelectorAll('.tracker-item.done, .tracker-item.failed');
      items.forEach(function(el) { el.remove(); });
      if (!panel.querySelector('.tracker-item')) {
        panel.classList.add('tracker-collapsed');
      }
    });
    panel.appendChild(header);

    var list = document.createElement('div');
    list.className = 'tracker-list';
    panel.appendChild(list);

    document.body.appendChild(panel);
    getTrackerFab(); // ensure fab exists
    return panel;
  }

  function cancelTask(taskId) {
    chrome.runtime.sendMessage({ type: 'cancel-task', taskId: taskId }, function() {});
  }

  function updateTrackerItem(taskId, jobNames, currentStatus, error, mrTitle) {
    var panel = getTrackerPanel();
    panel.classList.remove('tracker-collapsed');
    getTrackerFab().classList.remove('fab-visible');
    var list = panel.querySelector('.tracker-list');

    var item = list.querySelector('[data-task-id="' + taskId + '"]');
    if (!item) {
      item = document.createElement('div');
      item.className = 'tracker-item';
      item.setAttribute('data-task-id', taskId);
      list.appendChild(item);
    }

    var currentJob = '';
    var statusMatch = currentStatus.match(/^running:\s*(.+)$/);
    if (statusMatch) currentJob = statusMatch[1];

    var isDone = currentStatus === 'done';
    var isError = currentStatus === 'error';
    var isRunning = !isDone && !isError;

    var stepsHtml = jobNames.map(function(name, i) {
      var cls = 'step';
      if (isDone) {
        cls += ' step-done';
      } else if (isError && name === currentJob) {
        cls += ' step-error';
      } else if (name === currentJob) {
        cls += ' step-active';
      } else {
        var currentIdx = jobNames.indexOf(currentJob);
        if (currentIdx >= 0 && i < currentIdx) {
          cls += ' step-done';
        }
      }
      return '<span class="' + cls + '">' + escHtml(name) + '</span>';
    }).join('<span class="step-arrow">\u2192</span>');

    var statusIcon = isDone ? '\u2713' : isError ? '\u2717' : '<span class="tracker-spinner"></span>';
    var statusCls = isDone ? 'tracker-success' : isError ? 'tracker-error' : 'tracker-running';

    var cancelHtml = isRunning ? '<button class="tracker-cancel" aria-label="Cancel" data-cancel-id="' + taskId + '">&times;</button>' : '';

    var titleHtml = mrTitle ? '<div class="tracker-mr-title">' + escHtml(mrTitle) + '</div>' : '';

    item.innerHTML = titleHtml + '<div class="tracker-row"><span class="tracker-icon ' + statusCls + '">' + statusIcon + '</span><div class="tracker-steps">' + stepsHtml + '</div>' + cancelHtml + '</div>' +
      (isError && error ? '<div class="tracker-error-msg">' + escHtml(error) + '</div>' : '');

    if (isDone || isError) {
      item.className = 'tracker-item ' + (isDone ? 'done' : 'failed');
    }

    var cancelBtn = item.querySelector('.tracker-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        cancelTask(cancelBtn.getAttribute('data-cancel-id'));
      });
    }
  }

  // =========================================================================
  // Restore active tasks on page load
  // =========================================================================

  function restoreActiveTasks() {
    chrome.runtime.sendMessage({ type: 'get-active-tasks' }, function(tasks) {
      if (chrome.runtime.lastError || !tasks || !tasks.length) return;
      tasks.forEach(function(t) {
        updateTrackerItem(t.taskId, t.jobs, t.status, null, t.mrTitle);
        pollTaskStatus(t.taskId, t.jobs, t.mrTitle);
      });
    });
  }

  function pollTaskStatus(taskId, jobNames, mrTitle) {
    var interval = setInterval(function() {
      chrome.runtime.sendMessage({ type: 'get-task-status', taskId: taskId }, function(resp) {
        if (chrome.runtime.lastError || !resp || resp.status === 'not_found') {
          clearInterval(interval);
          return;
        }
        updateTrackerItem(taskId, jobNames, resp.status, resp.error, mrTitle);
        if (resp.status === 'done' || resp.status === 'error') {
          clearInterval(interval);
        }
      });
    }, 10000);
  }

  // =========================================================================
  // Message listener
  // =========================================================================

  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    // Skip api-proxy if full content.js loaded (it handles this)
    if (msg.type === 'api-proxy' && !window.__glMrActionsLoaded) {
      api(msg.method, msg.path, msg.body)
        .then(function(data) { sendResponse(data); })
        .catch(function(err) { sendResponse({ _error: err.message }); });
      return true;
    }
    // Skip tracker updates if full content.js handles them
    if (window.__glMrActionsLoaded) return;
    if (msg.type === 'task-result') {
      if (msg.success) {
        updateTrackerItem(msg.taskId, msg.jobs || [], 'done', null, msg.mrTitle);
      } else {
        updateTrackerItem(msg.taskId, msg.jobs || [], 'error', msg.message, msg.mrTitle);
      }
    }
    if (msg.type === 'task-progress') {
      updateTrackerItem(msg.taskId, msg.jobs, msg.status, null, msg.mrTitle);
    }
  });

  // Only restore if full content.js isn't loaded (it does its own restore)
  if (!window.__glMrActionsLoaded) {
    restoreActiveTasks();
  }

  // =========================================================================
  // MR list page enhancements: dim drafts, highlight own MRs
  // =========================================================================

  function isMrListPage() {
    return /\/-\/merge_requests\/?(\?|$)/.test(window.location.pathname + window.location.search);
  }

  function getCurrentUsername() {
    var cacheKey = '_gl_mr_ext_username_' + GITLAB_URL;
    return new Promise(function(resolve) {
      // Check cache first
      chrome.storage.local.get(cacheKey, function(data) {
        if (chrome.runtime.lastError) { /* ignore */ }
        if (data && data[cacheKey]) { resolve(data[cacheKey]); return; }
        // Fetch from API
        api('GET', '/user').then(function(user) {
          if (user && user.username) {
            var toStore = {};
            toStore[cacheKey] = user.username;
            chrome.storage.local.set(toStore);
            resolve(user.username);
          } else {
            resolve(null);
          }
        }).catch(function() { resolve(null); });
      });
    });
  }

  function applyMrListEnhancements(settings, username) {
    var mrItems = qAll(document, SEL.mrItem);
    if (!mrItems.length) return;

    mrItems.forEach(function(item) {
      if (item.dataset.glMrEnhanced) return;
      item.dataset.glMrEnhanced = '1';

      // Dim drafts
      if (settings.dim_drafts) {
        var titleEl = q(item, SEL.titleLink);
        if (titleEl) {
          var title = titleEl.textContent.trim();
          if (/^(\[Draft\]|Draft:|WIP:)/i.test(title)) {
            item.classList.add('gl-mr-ext-dimmed');
          }
        }
      }

      // Highlight own MRs
      if (settings.highlight_own_mrs && username) {
        var authorLink = q(item, SEL.authorLink);
        if (authorLink) {
          var href = authorLink.getAttribute('href') || '';
          if (href.endsWith('/' + username)) {
            item.classList.add('gl-mr-ext-own');
          }
        }
      }

      // Copy MR button in controls bar
      if (settings.show_copy_mr) {
        var copyTitleEl = q(item, SEL.titleLink);
        var controlsUl = q(item, SEL.controls);
        if (copyTitleEl && controlsUl) {
          var li = document.createElement('li');
          li.className = 'gl-block has-tooltip !gl-mr-0 gl-mr-ext-copy-li';
          li.title = msg('btnCopyMr');
          li.innerHTML = '<svg class="gl-align-middle gl-mr-ext-copy-icon" width="22" height="22" viewBox="0 0 16 16"><path fill="currentColor" d="M10.5 2H5.5A1.5 1.5 0 004 3.5V4H3.5A1.5 1.5 0 002 5.5v7A1.5 1.5 0 003.5 14h5a1.5 1.5 0 001.5-1.5V12h.5a1.5 1.5 0 001.5-1.5v-7A1.5 1.5 0 0010.5 2zM9 12.5a.5.5 0 01-.5.5h-5a.5.5 0 01-.5-.5v-7a.5.5 0 01.5-.5H4v5.5A1.5 1.5 0 005.5 12H9v.5zm2-2a.5.5 0 01-.5.5h-5a.5.5 0 01-.5-.5v-7a.5.5 0 01.5-.5h5a.5.5 0 01.5.5v7z"/></svg>';
          li.style.cursor = 'pointer';
          li.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var mrTitle = copyTitleEl.textContent.trim();
            var mrUrl = copyTitleEl.href;
            navigator.clipboard.writeText(mrTitle + '\n' + mrUrl).then(function() {
              li.querySelector('svg').style.color = '#108548';
              setTimeout(function() {
                li.querySelector('svg').style.color = '';
              }, 1500);
            });
          });
          var lastLi = controlsUl.lastElementChild;
          controlsUl.appendChild(li);
          if (lastLi) lastLi.style.marginRight = '0';
        }
      }
    });
  }

  // =========================================================================
  // MR list toolbar: "Only mine" toggle
  // =========================================================================

  function msg(key) {
    try { return chrome.i18n.getMessage(key) || key; } catch(e) { return key; }
  }

  function isFilteredBy(param, value) {
    return new URL(window.location.href).searchParams.get(param) === value;
  }

  function toggleUrlParam(param, value) {
    var url = new URL(window.location.href);
    if (url.searchParams.get(param) === value) {
      url.searchParams.delete(param);
    } else {
      url.searchParams.set(param, value);
      url.searchParams.delete('page');
    }
    window.location.href = url.toString();
  }

  function injectListToggles(username, settings) {
    if (document.querySelector('.gl-mr-ext-toolbar')) return;

    var container = q(document, SEL.filterBar);
    if (!container) {
      // Vue may not have rendered the filter bar yet — look for any
      // toolbar-like area near the top of the MR list as a fallback
      container = q(document, '.top-area, .issues-filters, .nav-controls');
    }
    if (!container) return false; // signal caller to retry

    var toolbar = document.createElement('div');
    toolbar.className = 'gl-mr-ext-toolbar';
    toolbar.style.cssText = 'display:inline-flex;gap:6px;margin-left:8px;vertical-align:middle;';

    if (settings.show_only_mine && username) {
      var btnMine = document.createElement('button');
      btnMine.className = 'gl-mr-ext-toggle btn btn-md btn-default gl-button';
      btnMine.textContent = msg('toggleOnlyMine');
      if (isFilteredBy('author_username', username)) {
        btnMine.classList.add('active');
      }
      btnMine.addEventListener('click', function() {
        toggleUrlParam('author_username', username);
      });
      toolbar.appendChild(btnMine);
    }

    if (settings.show_needs_review && username) {
      var btnReview = document.createElement('button');
      btnReview.className = 'gl-mr-ext-toggle btn btn-md btn-default gl-button';
      btnReview.textContent = msg('toggleNeedsReview');
      if (isFilteredBy('reviewer_username', username)) {
        btnReview.classList.add('active');
      }
      btnReview.addEventListener('click', function() {
        toggleUrlParam('reviewer_username', username);
      });
      toolbar.appendChild(btnReview);
    }

    if (toolbar.childNodes.length) {
      container.appendChild(toolbar);
    }
    return true; // success
  }

  // =========================================================================
  // Jira ticket status badges on MR list
  // =========================================================================

  var _jiraCache = {}; // { ticket: { name, categoryKey, ts } }
  var JIRA_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
  var _jiraFetching = false;
  var _jiraRenderingBadges = false;
  var _jiraUrlStored = '';
  var _skipConfirmations = false;

  var _jiraTicketRegex = /[A-Z][A-Z0-9]+-\d+/g;

  function setJiraTicketRegex(pattern) {
    if (pattern) {
      try { _jiraTicketRegex = new RegExp(pattern, 'g'); } catch(e) { /* keep default */ }
    }
  }

  function parseTickets(title) {
    _jiraTicketRegex.lastIndex = 0;
    var m = title.match(_jiraTicketRegex);
    return m ? m : [];
  }

  function getJiraCategoryClass(categoryKey, name) {
    var lower = name.toLowerCase();
    if (lower.includes('qa')) return 'jira-qa';
    if (lower.includes('in review')) return 'jira-default';
    if (categoryKey === 'done') return 'jira-done';
    if (categoryKey === 'new') return 'jira-new';
    if (categoryKey === 'indeterminate' || lower.includes('in ')) return 'jira-progress';

    return 'jira-new';
  }

  function renderJiraLoaders(itemTicketMap) {
    itemTicketMap.forEach(function(entry) {
      if (entry.item.querySelector('.gl-jira-badge')) return; // already has badges
      var titleEl = q(entry.item, SEL.titleLink);
      if (!titleEl) return;
      var titleContainer = qUp(titleEl, SEL.titleWrap) || titleEl.parentNode;
      if (titleContainer.querySelector('.gl-jira-loader')) return; // already has loader
      var loader = document.createElement('span');
      loader.className = 'gl-jira-loader';
      titleContainer.appendChild(loader);
    });
  }

  function removeJiraLoaders() {
    var loaders = document.querySelectorAll('.gl-jira-loader');
    loaders.forEach(function(el) { el.remove(); });
  }

  function renderJiraBadges(mrItem, statuses) {
    var titleEl = q(mrItem, SEL.titleLink);
    if (!titleEl) return;

    var title = titleEl.textContent.trim();
    var tickets = parseTickets(title);
    if (!tickets.length) return;

    var titleContainer = qUp(titleEl, SEL.titleWrap) || titleEl.parentNode;

    // Build expected badge key to avoid redundant re-renders
    var badgeKey = tickets.map(function(t) {
      var s = statuses[t];
      return s ? t + ':' + s.name + ':' + (s.type || '') + ':' + (s.priority || '') + ':' + (_showJiraDetails ? '1' : '0') : '';
    }).join(',');

    if (mrItem.dataset.glJiraBadges === badgeKey) return;
    mrItem.dataset.glJiraBadges = badgeKey;

    // Remove old badges and icons
    var old = mrItem.querySelectorAll('.gl-jira-badge, .gl-jira-list-icon, .gl-jira-ticket-group, .gl-jira-ticket-sep');
    old.forEach(function(el) { el.remove(); });

    tickets.forEach(function(ticket, idx) {
      var status = statuses[ticket];
      if (!status) return;

      // Separator between ticket groups
      if (idx > 0) {
        var sep = document.createElement('span');
        sep.className = 'gl-jira-ticket-sep';
        titleContainer.appendChild(sep);
      }

      // Group wrapper for this ticket
      var group = document.createElement('span');
      group.className = 'gl-jira-ticket-group';

      // Type & priority icons (before status badge)
      if (_showJiraDetails) {
        if (status.typeIcon) {
          var typeEl = document.createElement('img');
          typeEl.className = 'gl-jira-list-icon';
          typeEl.src = status.typeIcon;
          typeEl.title = status.type || '';
          group.appendChild(typeEl);
        }
        if (status.priorityIcon) {
          var prioEl = document.createElement('img');
          prioEl.className = 'gl-jira-list-icon';
          prioEl.src = status.priorityIcon;
          prioEl.title = status.priority || '';
          group.appendChild(prioEl);
        }
      }

      var badge = document.createElement('span');
      badge.className = 'gl-jira-badge ' + getJiraCategoryClass(status.categoryKey, status.name);
      badge.textContent = status.name;
      badge.title = ticket + ': ' + status.name;
      badge.style.cursor = 'pointer';
      badge.dataset.jiraTicket = ticket;
      badge.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        openJiraSidebar(ticket, _jiraUrlStored);
      });
      group.appendChild(badge);

      titleContainer.appendChild(group);
    });
  }

  // ── Jira sidebar ──────────────────────────────────────────────────
  function openJiraSidebar(ticket, jiraUrl) {
    // Remove existing sidebar
    var existing = document.querySelector('.gl-jira-sidebar');
    var reuse = false;
    if (existing) {
      if (existing.dataset.ticket === ticket) {
        existing.classList.add('gl-jira-sidebar-closing');
        existing.addEventListener('animationend', function() { existing.remove(); });
        return;
      }
      // Reuse existing sidebar — just swap content, no animation
      reuse = true;
      existing.dataset.ticket = ticket;
      var ticketLink = existing.querySelector('.gl-jira-sidebar-header .gfm-issue');
      if (ticketLink) {
        ticketLink.textContent = ticket;
        ticketLink.href = _jiraUrlStored + '/browse/' + ticket;
      }
      existing.querySelector('.gl-jira-sidebar-body').innerHTML =
        '<div class="gl-jira-sidebar-loading"><div class="gl-jira-sidebar-spinner"></div></div>';
    }

    var sidebar = reuse ? existing : document.createElement('div');
    if (!reuse) {
      sidebar.className = 'gl-jira-sidebar';
      sidebar.dataset.ticket = ticket;
      sidebar.innerHTML =
        '<div class="gl-jira-sidebar-header">' +
          '<a href="' + escHtml(jiraUrl + '/browse/' + ticket) + '" target="_blank" class="gfm gfm-issue">' + escHtml(ticket) + '</a>' +
          '<button class="gl-jira-sidebar-close" title="Close">&times;</button>' +
        '</div>' +
        '<div class="gl-jira-sidebar-body">' +
          '<div class="gl-jira-sidebar-loading"><div class="gl-jira-sidebar-spinner"></div></div>' +
        '</div>';
      document.body.appendChild(sidebar);
    }

    function closeSidebar() {
      sidebar.classList.add('gl-jira-sidebar-closing');
      sidebar.addEventListener('animationend', function() { sidebar.remove(); });
      document.removeEventListener('keydown', onEsc);
    }

    // Close button
    sidebar.querySelector('.gl-jira-sidebar-close').addEventListener('click', closeSidebar);

    // Close on Escape — lightbox first, then sidebar
    function onEsc(e) {
      if (e.key === 'Escape') {
        var lightbox = document.querySelector('.gl-jira-lightbox');
        if (lightbox) {
          closeLightbox(lightbox);
          return;
        }
        closeSidebar();
      }
    }
    document.addEventListener('keydown', onEsc);

    // Delegate click on images to open lightbox
    sidebar.addEventListener('click', function(e) {
      var img = e.target.closest('.gl-jira-sidebar-img');
      if (img) {
        openJiraLightbox(img.src, 'image');
        return;
      }
      var media = e.target.closest('.gl-jira-sidebar-attach-media');
      if (media) {
        e.preventDefault();
        openJiraLightbox(media.dataset.url, media.dataset.type);
      }
    });

    // Fetch full issue data
    chrome.runtime.sendMessage({
      type: 'fetch-jira-issue',
      jiraUrl: jiraUrl,
      ticket: ticket
    }, function(resp) {
      if (!resp || resp._error) {
        sidebar.querySelector('.gl-jira-sidebar-body').innerHTML =
          '<div class="gl-jira-sidebar-error">' + escHtml(resp ? resp._error : 'No response') + '</div>';
        return;
      }
      renderJiraSidebarContent(sidebar, resp, jiraUrl);
      chrome.storage.sync.get({ jiraQuickActions: [] }, function(s) {
        loadJiraTransitions(sidebar, resp.key, jiraUrl, s.jiraQuickActions || []);
      });
      initAssigneeEditor(sidebar, resp.key, jiraUrl);
    });
  }

  function loadJiraTransitions(sidebar, ticket, jiraUrl, quickActions) {
    chrome.runtime.sendMessage({
      type: 'fetch-jira-transitions',
      jiraUrl: jiraUrl,
      ticket: ticket
    }, function(resp) {
      var container = sidebar.querySelector('#gl-jira-sidebar-transitions');
      if (!container || !resp || resp._error) return;

      var transitions = resp.transitions || [];
      var transitionMap = {};
      transitions.forEach(function(t) {
        transitionMap[(t.statusName || t.name).toLowerCase()] = t;
      });

      // Render individual transition buttons
      var html = transitions.map(function(t) {
        var cls = getJiraCategoryClass(t.statusCategoryKey, t.statusName || t.name);
        return '<button class="gl-jira-sidebar-transition gl-jira-badge ' + cls + '" data-id="' + escHtml(t.id) + '" data-name="' + escHtml(t.statusName || t.name) + '" data-category="' + escHtml(t.statusCategoryKey) + '">' +
          '&#8594; ' + escHtml(t.statusName || t.name) +
        '</button>';
      }).join('');

      // Render quick action buttons (only if matching transition is available)
      if (quickActions && quickActions.length) {
        var qaHtml = '';
        quickActions.forEach(function(qa) {
          var matchedTransition = qa.status ? transitionMap[qa.status.toLowerCase()] : null;
          // Show quick action if: has matching transition OR only has assignee (no status change needed)
          if (matchedTransition || (!qa.status && qa.assignee)) {
            qaHtml += '<button class="gl-jira-sidebar-quick-action" ' +
              'data-transition-id="' + (matchedTransition ? escHtml(matchedTransition.id) : '') + '" ' +
              'data-status-name="' + (matchedTransition ? escHtml(matchedTransition.statusName || matchedTransition.name) : '') + '" ' +
              'data-status-category="' + (matchedTransition ? escHtml(matchedTransition.statusCategoryKey) : '') + '" ' +
              'data-assignee="' + escHtml(qa.assignee || '') + '">' +
              '&#9889; ' + escHtml(qa.label) +
            '</button>';
          }
        });
        if (qaHtml) {
          html += '<div class="gl-jira-sidebar-qa-sep"></div>' + qaHtml;
        }
      }

      container.innerHTML = html;

      // Transition click handler
      container.addEventListener('click', function(e) {
        var quickBtn = e.target.closest('.gl-jira-sidebar-quick-action');
        if (quickBtn && !quickBtn.disabled) {
          executeQuickAction(sidebar, quickBtn, ticket, jiraUrl, quickActions);
          return;
        }

        var btn = e.target.closest('.gl-jira-sidebar-transition');
        if (!btn || btn.disabled) return;

        if (!_skipConfirmations && !confirm(btn.dataset.name + '?')) return;

        disableAllTransitionBtns(container);
        btn.style.opacity = '1';
        btn.textContent = '...';

        doTransition(sidebar, ticket, jiraUrl, btn.dataset.id, btn.dataset.name, btn.dataset.category, quickActions);
      });
    });
  }

  function disableAllTransitionBtns(container) {
    container.querySelectorAll('button').forEach(function(b) { b.disabled = true; b.style.opacity = '0.5'; });
  }

  function updateStatusAfterTransition(sidebar, ticket, statusName, categoryKey) {
    var statusBadge = sidebar.querySelector('#gl-jira-sidebar-status');
    if (statusBadge) {
      var cls = getJiraCategoryClass(categoryKey, statusName);
      statusBadge.className = 'gl-jira-badge ' + cls;
      statusBadge.textContent = statusName;
    }
    delete _jiraCache[ticket];
    var cls2 = getJiraCategoryClass(categoryKey, statusName);
    document.querySelectorAll('.gl-jira-badge[data-jira-ticket="' + ticket + '"]').forEach(function(b) {
      b.className = 'gl-jira-badge ' + cls2;
      b.textContent = statusName;
      b.title = ticket + ': ' + statusName;
    });
  }

  function doTransition(sidebar, ticket, jiraUrl, transitionId, statusName, categoryKey, quickActions) {
    chrome.runtime.sendMessage({
      type: 'do-jira-transition',
      jiraUrl: jiraUrl,
      ticket: ticket,
      transitionId: transitionId
    }, function(result) {
      if (result && result.success) {
        updateStatusAfterTransition(sidebar, ticket, statusName, categoryKey);
        loadJiraTransitions(sidebar, ticket, jiraUrl, quickActions);
      } else {
        var container = sidebar.querySelector('#gl-jira-sidebar-transitions');
        if (container) container.querySelectorAll('button').forEach(function(b) { b.disabled = false; b.style.opacity = '1'; });
      }
    });
  }

  function executeQuickAction(sidebar, btn, ticket, jiraUrl, quickActions) {
    var transitionId = btn.dataset.transitionId;
    var statusName = btn.dataset.statusName;
    var categoryKey = btn.dataset.statusCategory;
    var assignee = btn.dataset.assignee;

    var container = sidebar.querySelector('#gl-jira-sidebar-transitions');
    disableAllTransitionBtns(container);
    btn.style.opacity = '1';
    btn.textContent = '...';

    var steps = [];
    if (transitionId) {
      steps.push(function(cb) {
        chrome.runtime.sendMessage({
          type: 'do-jira-transition', jiraUrl: jiraUrl, ticket: ticket, transitionId: transitionId
        }, function(r) { cb(r && r.success); });
      });
    }
    if (assignee) {
      steps.push(function(cb) {
        chrome.runtime.sendMessage({
          type: 'set-jira-assignee', jiraUrl: jiraUrl, ticket: ticket, username: assignee
        }, function(r) { cb(r && r.success); });
      });
    }

    function runStep(i) {
      if (i >= steps.length) {
        // All done — update UI
        if (statusName) updateStatusAfterTransition(sidebar, ticket, statusName, categoryKey);
        if (assignee) {
          var assigneeEl = sidebar.querySelector('#gl-jira-sidebar-assignee');
          if (assigneeEl) assigneeEl.innerHTML = escHtml(assignee) + ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>';
        }
        loadJiraTransitions(sidebar, ticket, jiraUrl, quickActions);
        return;
      }
      steps[i](function(ok) {
        if (ok) { runStep(i + 1); }
        else { container.querySelectorAll('button').forEach(function(b) { b.disabled = false; b.style.opacity = '1'; }); }
      });
    }
    runStep(0);
  }

  function initAssigneeEditor(sidebar, ticket, jiraUrl) {
    var assigneeEl = sidebar.querySelector('#gl-jira-sidebar-assignee');
    var searchBox = sidebar.querySelector('#gl-jira-sidebar-assignee-search');
    var input = searchBox.querySelector('.gl-jira-sidebar-assignee-input');
    var resultsEl = searchBox.querySelector('.gl-jira-sidebar-assignee-results');
    var searchTimer = null;

    assigneeEl.addEventListener('click', function() {
      var isOpen = searchBox.style.display !== 'none';
      searchBox.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) {
        input.value = '';
        resultsEl.innerHTML = '';
        input.focus();
      }
    });

    // Unassign button
    searchBox.querySelector('.gl-jira-sidebar-unassign').addEventListener('click', function(e) {
      e.stopPropagation();
      chrome.runtime.sendMessage({
        type: 'set-jira-assignee',
        jiraUrl: jiraUrl,
        ticket: ticket,
        username: null
      }, function(result) {
        if (result && result.success) {
          assigneeEl.innerHTML = '<span style="opacity:0.5">' + escHtml(chrome.i18n.getMessage('jiraSidebarUnassigned') || 'Unassigned') + '</span>' +
            ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>';
          searchBox.style.display = 'none';
        }
      });
    });

    input.addEventListener('input', function() {
      var query = input.value.trim();
      clearTimeout(searchTimer);
      if (query.length < 2) { resultsEl.innerHTML = ''; return; }
      searchTimer = setTimeout(function() {
        resultsEl.innerHTML = '<div class="gl-jira-sidebar-assignee-loading">...</div>';
        chrome.runtime.sendMessage({
          type: 'search-jira-assignable',
          jiraUrl: jiraUrl,
          ticket: ticket,
          query: query
        }, function(resp) {
          if (!resp || resp._error || !resp.users) {
            resultsEl.innerHTML = '';
            return;
          }
          if (!resp.users.length) {
            resultsEl.innerHTML = '<div class="gl-jira-sidebar-assignee-empty">' +
              escHtml(chrome.i18n.getMessage('jiraSidebarNoUsers') || 'No users found') + '</div>';
            return;
          }
          resultsEl.innerHTML = resp.users.map(function(u) {
            return '<div class="gl-jira-sidebar-assignee-item" data-key="' + escHtml(u.key) + '" data-name="' + escHtml(u.name) + '">' +
              (u.avatar ? '<img src="' + escHtml(u.avatar) + '" class="gl-jira-sidebar-assignee-avatar">' : '') +
              '<span>' + escHtml(u.name) + '</span>' +
            '</div>';
          }).join('');
        });
      }, 300);
    });

    // Prevent click inside search from closing it
    searchBox.addEventListener('click', function(e) { e.stopPropagation(); });

    resultsEl.addEventListener('click', function(e) {
      var item = e.target.closest('.gl-jira-sidebar-assignee-item');
      if (!item) return;

      var username = item.dataset.key;
      var displayName = item.dataset.name;

      input.disabled = true;
      resultsEl.innerHTML = '<div class="gl-jira-sidebar-assignee-loading">...</div>';

      chrome.runtime.sendMessage({
        type: 'set-jira-assignee',
        jiraUrl: jiraUrl,
        ticket: ticket,
        username: username
      }, function(result) {
        if (result && result.success) {
          assigneeEl.innerHTML = escHtml(displayName) + ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>';
          searchBox.style.display = 'none';
        }
        input.disabled = false;
      });
    });
  }

  function closeLightbox(el) {
    el.classList.add('gl-jira-lightbox-closing');
    el.addEventListener('animationend', function() { el.remove(); });
  }

  function openJiraLightbox(src, type) {
    var existing = document.querySelector('.gl-jira-lightbox');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'gl-jira-lightbox';
    if (type === 'video') {
      overlay.innerHTML = '<video src="' + escHtml(src) + '" controls autoplay class="gl-jira-lightbox-video"></video>';
    } else {
      overlay.innerHTML = '<img src="' + escHtml(src) + '" class="gl-jira-lightbox-img">';
    }
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeLightbox(overlay);
    });
    document.body.appendChild(overlay);
  }

  function formatJiraDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var now = new Date();
    var diff = now - d;
    var mins = Math.floor(diff / 60000);
    var hours = Math.floor(diff / 3600000);
    var days = Math.floor(diff / 86400000);
    if (mins < 60) return mins + 'm ago';
    if (hours < 24) return hours + 'h ago';
    if (days < 30) return days + 'd ago';
    return d.toLocaleDateString();
  }

  function renderJiraSidebarContent(sidebar, data, jiraUrl) {
    var statusClass = getJiraCategoryClass(data.statusCategoryKey, data.status);
    var desc = data.description || '';
    var attachments = data.attachments || {};
    // Truncate long descriptions (but keep image markup intact)
    if (desc.length > 3000) desc = desc.substring(0, 3000) + '...';
    // Simple formatting: escape HTML first, then replace wiki markup
    var descHtml = escHtml(desc).replace(/\n/g, '<br>');
    // Replace Jira wiki image markup: !filename|params! or !filename!
    descHtml = descHtml.replace(/!([^|!]+?)(?:\|[^!]*)?\!/g, function(match, filename) {
      var url = attachments[filename];
      if (!url) return match;
      var ext = filename.split('.').pop().toLowerCase();
      if (ext === 'mp4' || ext === 'webm' || ext === 'ogg' || ext === 'mov') {
        return '<video src="' + escHtml(url) + '" controls class="gl-jira-sidebar-video"></video>';
      }
      return '<img src="' + escHtml(url) + '" alt="' + escHtml(filename) + '" class="gl-jira-sidebar-img">';
    });
    // Replace Jira wiki links: [text|url] or [url]
    descHtml = descHtml.replace(/\[([^|\]\n]+)\|([^\]\n]+?)(?:\|[^\]\n]*)?\]/g, function(m, text, url) {
      return '<a href="' + escHtml(url) + '" target="_blank" class="gl-jira-sidebar-inline-link">' + text + '</a>';
    });
    descHtml = descHtml.replace(/\[(https?:\/\/[^\]\n]+)\]/g, function(m, url) {
      return '<a href="' + escHtml(url) + '" target="_blank" class="gl-jira-sidebar-inline-link">' + url + '</a>';
    });
    // Auto-link bare URLs not already inside href or <a> tags
    descHtml = descHtml.replace(/(^|[^"=])(https?:\/\/[^\s<]+)/g, function(m, prefix, url) {
      return prefix + '<a href="' + url + '" target="_blank" class="gl-jira-sidebar-inline-link">' + url + '</a>';
    });

    var rows = '';

    // Status
    rows += '<div class="gl-jira-sidebar-row">' +
      '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarStatus') || 'Status') + '</span>' +
      '<span class="gl-jira-badge ' + statusClass + '" id="gl-jira-sidebar-status">' + escHtml(data.status) + '</span>' +
    '</div>' +
    '<div class="gl-jira-sidebar-transitions" id="gl-jira-sidebar-transitions"></div>';

    // Resolution
    if (data.resolution) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarResolution') || 'Resolution') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + escHtml(data.resolution) + '</span>' +
      '</div>';
    }

    // Type
    if (data.type) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarType') || 'Type') + '</span>' +
        '<span class="gl-jira-sidebar-value"><span class="gl-jira-priority">' + (data.typeIcon ? '<img class="gl-jira-priority-icon" src="' + escHtml(data.typeIcon) + '" alt="">' : '') + escHtml(data.type) + '</span></span>' +
      '</div>';
    }

    // Priority
    if (data.priority) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarPriority') || 'Priority') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + getPriorityHtml(data.priority, data.priorityIcon) + '</span>' +
      '</div>';
    }

    // Assignee (editable)
    rows += '<div class="gl-jira-sidebar-row">' +
      '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarAssignee') || 'Assignee') + '</span>' +
      '<span class="gl-jira-sidebar-value gl-jira-sidebar-assignee" id="gl-jira-sidebar-assignee" data-ticket="' + escHtml(data.key) + '">' +
        (data.assignee ? escHtml(data.assignee) : '<span style="opacity:0.5">' + escHtml(chrome.i18n.getMessage('jiraSidebarUnassigned') || 'Unassigned') + '</span>') +
        ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>' +
      '</span>' +
    '</div>' +
    '<div class="gl-jira-sidebar-assignee-search" id="gl-jira-sidebar-assignee-search" style="display:none">' +
      '<div style="display:flex;gap:6px">' +
        '<input type="text" class="gl-jira-sidebar-assignee-input" placeholder="' + escHtml(chrome.i18n.getMessage('jiraSidebarSearchUser') || 'Search user...') + '" style="flex:1">' +
        '<button class="gl-jira-sidebar-unassign" title="' + escHtml(chrome.i18n.getMessage('jiraSidebarUnassign') || 'Unassign') + '">&times;</button>' +
      '</div>' +
      '<div class="gl-jira-sidebar-assignee-results"></div>' +
    '</div>';

    // Reporter
    if (data.reporter) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarReporter') || 'Reporter') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + escHtml(data.reporter) + '</span>' +
      '</div>';
    }

    // Labels
    if (data.labels && data.labels.length) {
      var labelsHtml = data.labels.map(function(l) {
        return '<span class="gl-jira-sidebar-label-tag">' + escHtml(l) + '</span>';
      }).join(' ');
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarLabels') || 'Labels') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + labelsHtml + '</span>' +
      '</div>';
    }

    // Epic Link
    if (data.epicLink) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarEpic') || 'Epic') + '</span>' +
        '<span class="gl-jira-sidebar-value"><a href="' + escHtml(jiraUrl) + '/browse/' + escHtml(data.epicLink) + '" target="_blank" class="gl-jira-sidebar-inline-link">' + escHtml(data.epicLink) + '</a></span>' +
      '</div>';
    }

    // Sprint
    if (data.sprint) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarSprint') || 'Sprint') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + escHtml(data.sprint) + '</span>' +
      '</div>';
    }

    // Components
    if (data.components && data.components.length) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarComponents') || 'Components') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + data.components.map(function(c) {
          return '<span class="gl-jira-sidebar-label-tag">' + escHtml(c) + '</span>';
        }).join(' ') + '</span>' +
      '</div>';
    }

    // Affects Versions
    if (data.versions && data.versions.length) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarAffectsVersions') || 'Affects') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + data.versions.map(function(v) {
          return '<span class="gl-jira-sidebar-label-tag">' + escHtml(v) + '</span>';
        }).join(' ') + '</span>' +
      '</div>';
    }

    // Fix Versions
    if (data.fixVersions && data.fixVersions.length) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarFixVersions') || 'Fix ver.') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + data.fixVersions.map(function(v) {
          return '<span class="gl-jira-sidebar-label-tag">' + escHtml(v) + '</span>';
        }).join(' ') + '</span>' +
      '</div>';
    }

    // Created / Updated
    if (data.created) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarCreated') || 'Created') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + escHtml(formatJiraDate(data.created)) + '</span>' +
      '</div>';
    }
    if (data.updated) {
      rows += '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarUpdated') || 'Updated') + '</span>' +
        '<span class="gl-jira-sidebar-value">' + escHtml(formatJiraDate(data.updated)) + '</span>' +
      '</div>';
    }

    var bodyHtml =
      '<h3 class="gl-jira-sidebar-title">' + escHtml(data.summary) + '</h3>' +
      '<div class="gl-jira-sidebar-fields">' + rows + '</div>';

    // Description
    if (desc) {
      bodyHtml += '<div class="gl-jira-sidebar-sep"></div>' +
        '<div class="gl-jira-sidebar-desc-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarDescription') || 'Description') + '</div>' +
        '<div class="gl-jira-sidebar-desc">' + descHtml + '</div>';
    }

    // Attachments list
    if (data.attachmentList && data.attachmentList.length) {
      bodyHtml += '<div class="gl-jira-sidebar-sep"></div>' +
        '<div class="gl-jira-sidebar-desc-label">' + escHtml(chrome.i18n.getMessage('jiraSidebarAttachments') || 'Attachments') + ' (' + data.attachmentList.length + ')</div>' +
        '<div class="gl-jira-sidebar-attachments">';
      data.attachmentList.forEach(function(a) {
        var ext = a.filename.split('.').pop().toLowerCase();
        var isImage = ['png','jpg','jpeg','gif','bmp','svg','webp'].indexOf(ext) !== -1;
        var isVideo = ['mp4','webm','ogg','mov'].indexOf(ext) !== -1;
        var sizeStr = a.size < 1024 ? a.size + ' B'
          : a.size < 1048576 ? Math.round(a.size / 1024) + ' KB'
          : (a.size / 1048576).toFixed(1) + ' MB';
        if (isImage) {
          bodyHtml += '<div class="gl-jira-sidebar-attach-item gl-jira-sidebar-attach-media" data-url="' + escHtml(a.url) + '" data-type="image">' +
            '<img src="' + escHtml(a.url) + '" class="gl-jira-sidebar-attach-thumb">' +
            '<span class="gl-jira-sidebar-attach-name">' + escHtml(a.filename) + '</span>' +
            '<span class="gl-jira-sidebar-attach-size">' + sizeStr + '</span>' +
          '</div>';
        } else if (isVideo) {
          bodyHtml += '<div class="gl-jira-sidebar-attach-item gl-jira-sidebar-attach-media" data-url="' + escHtml(a.url) + '" data-type="video">' +
            '<span class="gl-jira-sidebar-attach-icon">&#9654;</span>' +
            '<span class="gl-jira-sidebar-attach-name">' + escHtml(a.filename) + '</span>' +
            '<span class="gl-jira-sidebar-attach-size">' + sizeStr + '</span>' +
          '</div>';
        } else {
          bodyHtml += '<a href="' + escHtml(a.url) + '" target="_blank" class="gl-jira-sidebar-attach-item">' +
            '<span class="gl-jira-sidebar-attach-icon">&#128196;</span>' +
            '<span class="gl-jira-sidebar-attach-name">' + escHtml(a.filename) + '</span>' +
            '<span class="gl-jira-sidebar-attach-size">' + sizeStr + '</span>' +
          '</a>';
        }
      });
      bodyHtml += '</div>';
    }


    sidebar.querySelector('.gl-jira-sidebar-body').innerHTML = bodyHtml;
  }
  // ── End Jira sidebar ────────────────────────────────────────────

  var _showJiraDetails = false;

  function fetchAndRenderJiraStatuses(jiraUrl, showDetails) {
    _showJiraDetails = !!showDetails;
    if (_jiraFetching) return;
    _jiraUrlStored = jiraUrl;

    var mrItems = qAll(document, SEL.mrItem);
    if (!mrItems.length) return;

    // Collect all tickets from all MR titles
    var allTickets = [];
    var itemTicketMap = [];
    mrItems.forEach(function(item) {
      var titleEl = q(item, SEL.titleLink);
      if (!titleEl) return;
      var tickets = parseTickets(titleEl.textContent.trim());
      if (tickets.length) {
        itemTicketMap.push({ item: item, tickets: tickets });
        tickets.forEach(function(t) {
          if (allTickets.indexOf(t) === -1) allTickets.push(t);
        });
      }
    });

    if (!allTickets.length) return;

    // Check cache, find tickets that need fetching
    var now = Date.now();
    var cachedStatuses = {};
    var ticketsToFetch = [];

    allTickets.forEach(function(t) {
      if (_jiraCache[t] && (now - _jiraCache[t].ts) < JIRA_CACHE_TTL) {
        cachedStatuses[t] = _jiraCache[t];
      } else {
        ticketsToFetch.push(t);
      }
    });

    // Render cached ones immediately (inside flag to suppress observer)
    if (Object.keys(cachedStatuses).length) {
      _jiraRenderingBadges = true;
      itemTicketMap.forEach(function(entry) {
        renderJiraBadges(entry.item, cachedStatuses);
      });
      _jiraRenderingBadges = false;
    }

    if (!ticketsToFetch.length) return;

    // Show loaders for items that don't have badges yet
    _jiraRenderingBadges = true;
    renderJiraLoaders(itemTicketMap);
    _jiraRenderingBadges = false;

    // Fetch remaining from Jira via background
    _jiraFetching = true;
    chrome.runtime.sendMessage({
      type: 'fetch-jira-statuses',
      jiraUrl: jiraUrl,
      tickets: ticketsToFetch,
      showDetails: _showJiraDetails,
    }, function(resp) {
      _jiraFetching = false;
      _jiraRenderingBadges = true;
      removeJiraLoaders();
      _jiraRenderingBadges = false;
      if (chrome.runtime.lastError || !resp || resp._error) return;
      var statuses = resp.statuses || {};

      // Update cache
      var fetchedNow = Date.now();
      for (var t in statuses) {
        _jiraCache[t] = { name: statuses[t].name, categoryKey: statuses[t].categoryKey, priority: statuses[t].priority, priorityIcon: statuses[t].priorityIcon, type: statuses[t].type, typeIcon: statuses[t].typeIcon, ts: fetchedNow };
      }

      // Merge with cached
      var merged = {};
      for (var k in cachedStatuses) merged[k] = cachedStatuses[k];
      for (var k2 in statuses) merged[k2] = statuses[k2];

      _jiraRenderingBadges = true;
      itemTicketMap.forEach(function(entry) {
        renderJiraBadges(entry.item, merged);
      });
      _jiraRenderingBadges = false;
    });
  }

  // =========================================================================
  // Reviewer badge from comments
  // =========================================================================

  var _reviewerCache = {}; // { mrUrl: { isReviewer: bool, ts: number } }
  var REVIEWER_CACHE_TTL = 5 * 60 * 1000;
  var _reviewerFetching = false;

  function parseMrPath(href) {
    var m = href.match(/^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/(\d+)/);
    if (!m) return null;
    return { projectPath: m[1], iid: m[2] };
  }

  function fetchMrNotes(projectPath, iid) {
    var encodedProject = encodeURIComponent(projectPath);
    return api('GET', '/projects/' + encodedProject + '/merge_requests/' + iid + '/notes?per_page=10&sort=asc');
  }

  function checkReviewerInNotes(notes, username) {
    for (var i = 0; i < notes.length; i++) {
      var body = notes[i].body || '';
      if (/reviewers?\s*:/i.test(body) && body.indexOf('@' + username) !== -1) {
        return true;
      }
    }
    return false;
  }

  function renderReviewerBadge(mrItem, isReviewer) {
    if (mrItem.querySelector('.gl-reviewer-badge')) return;
    if (!isReviewer) return;

    var titleEl = q(mrItem, SEL.titleLink);
    if (!titleEl) return;
    var titleContainer = qUp(titleEl, SEL.titleWrap) || titleEl.parentNode;

    var badge = document.createElement('span');
    badge.className = 'gl-reviewer-badge';
    badge.textContent = msg('badgeYourReview');
    badge.title = msg('badgeYourReviewHint');
    titleContainer.appendChild(badge);
  }

  function fetchAndRenderReviewerBadges(username) {
    if (_reviewerFetching) return;

    var mrItems = qAll(document, SEL.mrItem);
    if (!mrItems.length) return;

    var toFetch = [];
    var now = Date.now();

    mrItems.forEach(function(item) {
      var titleEl = q(item, SEL.titleLink);
      if (!titleEl) return;
      var href = titleEl.href;
      var cached = _reviewerCache[href];
      if (cached && (now - cached.ts) < REVIEWER_CACHE_TTL) {
        _jiraRenderingBadges = true;
        renderReviewerBadge(item, cached.isReviewer);
        _jiraRenderingBadges = false;
        return;
      }
      var parsed = parseMrPath(href);
      if (parsed) {
        toFetch.push({ item: item, href: href, projectPath: parsed.projectPath, iid: parsed.iid });
      }
    });

    if (!toFetch.length) return;

    // Show loaders
    _jiraRenderingBadges = true;
    toFetch.forEach(function(entry) {
      if (entry.item.querySelector('.gl-reviewer-badge, .gl-reviewer-loader')) return;
      var titleEl = q(entry.item, SEL.titleLink);
      if (!titleEl) return;
      var titleContainer = qUp(titleEl, SEL.titleWrap) || titleEl.parentNode;
      var loader = document.createElement('span');
      loader.className = 'gl-reviewer-loader gl-jira-loader';
      titleContainer.appendChild(loader);
    });
    _jiraRenderingBadges = false;

    _reviewerFetching = true;

    function fetchOne(i) {
      if (i >= toFetch.length) {
        _reviewerFetching = false;
        _jiraRenderingBadges = true;
        var loaders = document.querySelectorAll('.gl-reviewer-loader');
        loaders.forEach(function(el) { el.remove(); });
        _jiraRenderingBadges = false;
        return;
      }
      var entry = toFetch[i];
      fetchMrNotes(entry.projectPath, entry.iid)
        .then(function(notes) {
          var isReviewer = checkReviewerInNotes(notes || [], username);
          _reviewerCache[entry.href] = { isReviewer: isReviewer, ts: Date.now() };
          _jiraRenderingBadges = true;
          renderReviewerBadge(entry.item, isReviewer);
          _jiraRenderingBadges = false;
        })
        .catch(function() {})
        .then(function() { fetchOne(i + 1); });
    }

    fetchOne(0);
  }

  // =========================================================================
  // Unresolved threads count (#26) + MR size labels (#27)
  // =========================================================================

  var _mrMetaCache = {}; // { href: { threads, changes, ts } }
  var MR_META_CACHE_TTL = 5 * 60 * 1000;
  var _mrMetaFetching = false;

  function renderThreadsBadge(mrItem, count) {
    if (mrItem.querySelector('.gl-mr-ext-threads-badge')) return;
    if (count === 0) return;

    var controlsUl = q(mrItem, SEL.controls);
    if (!controlsUl) return;

    var li = document.createElement('li');
    li.className = 'gl-mr-ext-threads-badge';
    li.title = count + ' unresolved thread' + (count === 1 ? '' : 's');
    li.innerHTML = '<svg viewBox="0 0 16 16" class="s16"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M2.75 1.75h10.5c.55 0 1 .45 1 1v7c0 .55-.45 1-1 1H8.56l-3.4 3.4a.25.25 0 0 1-.43-.18V10.75H2.75c-.55 0-1-.45-1-1v-7c0-.55.45-1 1-1Z"/><line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="7.5" x2="9" y2="7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
      '<span>' + count + '</span>';

    // Insert after comments icon if found, otherwise prepend to controls
    var commentsEl = q(mrItem, SEL.comments);
    var commentsLi = commentsEl ? commentsEl.closest('li') : null;
    if (commentsLi && commentsLi.nextSibling) {
      controlsUl.insertBefore(li, commentsLi.nextSibling);
    } else if (commentsLi) {
      controlsUl.appendChild(li);
    } else {
      controlsUl.insertBefore(li, controlsUl.firstChild);
    }
  }

  function renderSizeBadge(mrItem, changesLines, changesFiles) {
    if (mrItem.querySelector('.gl-mr-ext-size-badge')) return;
    var titleEl = q(mrItem, SEL.titleLink);
    if (!titleEl) return;
    var titleContainer = qUp(titleEl, SEL.titleWrap) || titleEl.parentNode;

    var label, cls, tooltip;
    if (changesLines > 0) {
      // Size by lines changed
      if (changesLines <= 50) { label = 'S'; cls = 'size-s'; }
      else if (changesLines <= 200) { label = 'M'; cls = 'size-m'; }
      else if (changesLines <= 500) { label = 'L'; cls = 'size-l'; }
      else { label = 'XL'; cls = 'size-xl'; }
      tooltip = changesLines + ' lines, ' + changesFiles + ' files';
    } else {
      // Fallback: size by files changed
      if (changesFiles <= 5) { label = 'S'; cls = 'size-s'; }
      else if (changesFiles <= 15) { label = 'M'; cls = 'size-m'; }
      else if (changesFiles <= 30) { label = 'L'; cls = 'size-l'; }
      else { label = 'XL'; cls = 'size-xl'; }
      tooltip = changesFiles + ' files changed';
    }

    var badge = document.createElement('span');
    badge.className = 'gl-mr-ext-size-badge ' + cls;
    badge.textContent = label;
    badge.title = tooltip;
    // Always insert right after the title link, before Jira badges
    insertAfterSafe(titleContainer, badge, titleEl);
  }

  function renderConflictBadge(mrItem) {
    if (mrItem.querySelector('.gl-mr-ext-conflict-badge')) return;
    var titleEl = q(mrItem, SEL.titleLink);
    if (!titleEl) return;
    var titleContainer = qUp(titleEl, SEL.titleWrap) || titleEl.parentNode;
    var badge = document.createElement('span');
    badge.className = 'gl-mr-ext-conflict-badge';
    badge.title = msg('conflictsBadgeHint') || 'This merge request has conflicts';
    badge.textContent = msg('conflictsBadge') || 'CONFLICTS';
    // Insert right after size badge, or after title link
    var sizeBadge = mrItem.querySelector('.gl-mr-ext-size-badge');
    insertAfterSafe(titleContainer, badge, sizeBadge || titleEl);
  }

  function renderBranchBadge(mrItem, sourceBranch, targetBranch, clickable) {
    if (mrItem.querySelector('.gl-mr-ext-branch-badge')) return;
    if (!sourceBranch) return;
    var loader = mrItem.querySelector('.gl-mr-ext-branch-loader');
    if (loader) loader.remove();
    var infoRow = q(mrItem, SEL.issuableInfo);
    if (!infoRow) return;

    var projectBase = '';
    if (clickable) {
      var titleEl = q(mrItem, SEL.titleLink);
      if (titleEl && titleEl.href) {
        var m = titleEl.href.match(/^(https?:\/\/[^/]+\/.+?)\/-\/merge_requests\//);
        if (m) projectBase = m[1] + '/-/tree/';
      }
    }

    var wrap = document.createElement('div');
    wrap.className = 'gl-mr-ext-branch-badge';

    function makeBranchEl(branch) {
      var el;
      if (projectBase) {
        el = document.createElement('a');
        el.href = projectBase + encodeURIComponent(branch);
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
        el.className = 'ref-name';
      } else {
        el = document.createElement('span');
        el.className = 'ref-name';
      }
      el.textContent = branch;
      el.title = branch;
      return el;
    }

    wrap.appendChild(makeBranchEl(sourceBranch));
    if (targetBranch) {
      var arrow = document.createElement('span');
      arrow.className = 'gl-mr-ext-branch-arrow';
      arrow.innerHTML = '&#x2192;';
      wrap.appendChild(arrow);
      wrap.appendChild(makeBranchEl(targetBranch));
    }
    infoRow.parentNode.insertBefore(wrap, infoRow.nextSibling);
  }

  function renderApprovalIndicator(mrItem, approvedBy, username) {
    if (mrItem.querySelector('.gl-mr-ext-approval-done')) return;
    if (!approvedBy || !approvedBy.length) return;

    var myApproval = false;
    for (var i = 0; i < approvedBy.length; i++) {
      var u = approvedBy[i];
      var uname = (u.user && u.user.username) || u.username || '';
      if (uname === username) { myApproval = true; break; }
    }

    var names = approvedBy.map(function(a) { var u = a.user || a; return u.name || u.username || ''; }).join(', ');

    // Try to find and enhance the existing GitLab approval badge
    var nativeBadge = mrItem.querySelector('[data-testid="mr-appovals"], [data-testid="mr-approvals"]');
    if (!nativeBadge) {
      // Fallback: look for badge with "Approved" text
      var badges = mrItem.querySelectorAll('.gl-badge.badge-success, .gl-badge.badge-pill');
      for (var b = 0; b < badges.length; b++) {
        var txt = (badges[b].textContent || '').trim();
        if (txt.indexOf('Approved') !== -1 || txt.indexOf('approved') !== -1 || txt.indexOf('approval') !== -1) {
          nativeBadge = badges[b];
          break;
        }
      }
    }

    var youLabel = msg('approvalBadgeMineShort') || 'You';
    var othersCount = approvedBy.length - (myApproval ? 1 : 0);

    var suffix = myApproval
      ? youLabel + (othersCount > 0 ? ' +' + othersCount : '')
      : String(approvedBy.length);

    if (nativeBadge) {
      nativeBadge.classList.add('gl-mr-ext-approval-done');
      nativeBadge.title = names;
      var contentSpan = nativeBadge.querySelector('.gl-badge-content');
      if (contentSpan) {
        var origText = (contentSpan.textContent || '').trim();
        contentSpan.textContent = origText + ' \u00b7 ' + suffix;
      }
      return;
    }

    // Fallback: create our own badge in GitLab native style
    var controlsUl = q(mrItem, SEL.controls);
    if (!controlsUl) return;

    var li = document.createElement('li');
    li.style.cssText = 'display:inline-flex;align-items:center;margin-right:0;margin-left:0';
    var badge = document.createElement('span');
    badge.className = 'gl-badge badge badge-pill badge-success gl-mr-ext-approval-done';
    badge.title = names;
    badge.innerHTML = '<svg viewBox="0 0 16 16" class="gl-badge-icon gl-icon s16 gl-fill-current -gl-ml-2"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm3.03-8.47a.75.75 0 0 0-1.06-1.06L7 8.44 6.03 7.47a.75.75 0 0 0-1.06 1.06l1.5 1.5a.75.75 0 0 0 1.06 0l3.5-3.5Z" fill="currentColor"/></svg>'
      + ' <span class="gl-badge-content">Approved \u00b7 ' + escHtml(suffix) + '</span>';
    li.appendChild(badge);
    controlsUl.insertBefore(li, controlsUl.firstChild);
  }

  function fetchAndRenderMrMeta(showThreads, showSize, showConflicts, showApprovals, showBranches, showBranchesLinks, username) {
    if (_mrMetaFetching) return;

    var mrItems = qAll(document, SEL.mrItem);
    if (!mrItems.length) return;

    var toFetch = [];
    var now = Date.now();

    mrItems.forEach(function(item) {
      var titleEl = q(item, SEL.titleLink);
      if (!titleEl) return;
      var href = titleEl.href;
      var cached = _mrMetaCache[href];
      if (cached && (now - cached.ts) < MR_META_CACHE_TTL) {
        _jiraRenderingBadges = true;
        if (showThreads) renderThreadsBadge(item, cached.threads);
        if (showSize) renderSizeBadge(item, cached.changesLines, cached.changesFiles);
        if (showConflicts && cached.conflicts) renderConflictBadge(item);
        if (showApprovals && cached.approvedBy) renderApprovalIndicator(item, cached.approvedBy, username);
        if (showBranches) renderBranchBadge(item, cached.sourceBranch, cached.targetBranch, showBranchesLinks);
        _jiraRenderingBadges = false;
        return;
      }
      var parsed = parseMrPath(href);
      if (parsed) {
        toFetch.push({ item: item, href: href, projectPath: parsed.projectPath, iid: parsed.iid });
      }
    });

    if (!toFetch.length) return;
    _mrMetaFetching = true;

    // Show branch skeleton loaders for items about to be fetched
    if (showBranches) {
      _jiraRenderingBadges = true;
      toFetch.forEach(function(entry) {
        if (entry.item.querySelector('.gl-mr-ext-branch-badge, .gl-mr-ext-branch-loader')) return;
        var infoRow = q(entry.item, SEL.issuableInfo);
        if (!infoRow) return;
        var loader = document.createElement('div');
        loader.className = 'gl-mr-ext-branch-loader';
        var s1 = document.createElement('span');
        s1.className = 'gl-jira-loader';
        s1.style.width = '100px';
        var arrow = document.createElement('span');
        arrow.className = 'gl-mr-ext-branch-arrow';
        arrow.innerHTML = '&#x2192;';
        var s2 = document.createElement('span');
        s2.className = 'gl-jira-loader';
        s2.style.width = '60px';
        loader.appendChild(s1);
        loader.appendChild(arrow);
        loader.appendChild(s2);
        infoRow.parentNode.insertBefore(loader, infoRow.nextSibling);
      });
      _jiraRenderingBadges = false;
    }

    var BATCH_SIZE = 5;

    function fetchOneEntry(entry) {
      var encodedPath = encodeURIComponent(entry.projectPath);
      var mrPromise = api('GET', '/projects/' + encodedPath + '/merge_requests/' + entry.iid + '?include_rebase_in_progress=false');
      var approvalsPromise = showApprovals
        ? api('GET', '/projects/' + encodedPath + '/merge_requests/' + entry.iid + '/approvals').catch(function() { return null; })
        : Promise.resolve(null);
      var threadsPromise = showThreads
        ? api('GET', '/projects/' + encodedPath + '/merge_requests/' + entry.iid + '/discussions?per_page=100').catch(function() { return []; })
        : Promise.resolve(null);

      return Promise.all([mrPromise, approvalsPromise, threadsPromise])
        .then(function(results) {
          var mr = results[0];
          var approvalsData = results[1];
          var discussions = results[2];

          var changesLines = (mr.additions !== undefined && mr.deletions !== undefined)
            ? (parseInt(mr.additions) || 0) + (parseInt(mr.deletions) || 0)
            : 0;
          var changesFiles = mr.changes_count ? parseInt(mr.changes_count) : 0;
          var conflicts = !!mr.has_conflicts;
          var approvedBy = approvalsData ? (approvalsData.approved_by || []) : [];
          var unresolvedCount = 0;
          if (discussions) {
            (discussions || []).forEach(function(d) {
              if (d.notes && d.notes.length && d.notes[0].resolvable && !d.notes[0].resolved) {
                unresolvedCount++;
              }
            });
          }
          return { threads: unresolvedCount, changesLines: changesLines, changesFiles: changesFiles, conflicts: conflicts, approvedBy: approvedBy, sourceBranch: mr.source_branch || '', targetBranch: mr.target_branch || '' };
        })
        .then(function(meta) {
          _mrMetaCache[entry.href] = { threads: meta.threads, changesLines: meta.changesLines, changesFiles: meta.changesFiles, conflicts: meta.conflicts, approvedBy: meta.approvedBy, sourceBranch: meta.sourceBranch, targetBranch: meta.targetBranch, ts: Date.now() };
          _jiraRenderingBadges = true;
          if (showThreads) renderThreadsBadge(entry.item, meta.threads);
          if (showSize) renderSizeBadge(entry.item, meta.changesLines, meta.changesFiles);
          if (showConflicts && meta.conflicts) renderConflictBadge(entry.item);
          if (showApprovals && meta.approvedBy) renderApprovalIndicator(entry.item, meta.approvedBy, username);
          if (showBranches) renderBranchBadge(entry.item, meta.sourceBranch, meta.targetBranch, showBranchesLinks);
          _jiraRenderingBadges = false;
        })
        .catch(function() {});
    }

    function fetchBatch(start) {
      if (start >= toFetch.length) {
        _mrMetaFetching = false;
        return;
      }
      var batch = toFetch.slice(start, start + BATCH_SIZE);
      Promise.all(batch.map(fetchOneEntry)).then(function() {
        fetchBatch(start + BATCH_SIZE);
      });
    }

    fetchBatch(0);
  }

  // =========================================================================
  // Init MR list features
  // =========================================================================

  if (isMrListPage()) {
    var listDefaults = { dim_drafts: false, highlight_own_mrs: false, show_only_mine: false, show_needs_review: false, show_copy_mr: false, show_reviewer_badge: false, show_threads_badge: false, show_size_badge: false, show_conflicts_badge: false, show_approval_badge: false, show_branches: true, show_branches_links: false, show_jira_details: false, skip_confirmations: false, jira_url: '', jira_ticket_regex: '' };
    try {
      chrome.storage.sync.get(listDefaults, function(s) {
        if (chrome.runtime.lastError) return;
        _skipConfirmations = !!s.skip_confirmations;

        var needsUsername = s.highlight_own_mrs || s.show_only_mine || s.show_needs_review || s.show_reviewer_badge || s.show_approval_badge;
        var usernamePromise = needsUsername ? getCurrentUsername() : Promise.resolve(null);

        usernamePromise.then(function(username) {
          function runAllListFeatures() {
            if (s.dim_drafts || s.highlight_own_mrs || s.show_copy_mr) {
              applyMrListEnhancements(s, username);
            }
            if (s.show_reviewer_badge && username) {
              fetchAndRenderReviewerBadges(username);
            }
            if (s.show_threads_badge || s.show_size_badge || s.show_conflicts_badge || s.show_approval_badge || s.show_branches) {
              fetchAndRenderMrMeta(s.show_threads_badge, s.show_size_badge, s.show_conflicts_badge, s.show_approval_badge, s.show_branches, s.show_branches_links, username);
            }
            if (s.jira_url) {
              setJiraTicketRegex(s.jira_ticket_regex);
              fetchAndRenderJiraStatuses(s.jira_url, s.show_jira_details);
            }
          }

          // Run immediately; if DOM not ready yet, retry a few times
          var mrItems = qAll(document, SEL.mrItem);
          if (mrItems.length) {
            runAllListFeatures();
          } else {
            // Vue list may not be rendered yet — poll up to 3s
            var _retryCount = 0;
            var _retryInterval = setInterval(function() {
              _retryCount++;
              if (qAll(document, SEL.mrItem).length) {
                clearInterval(_retryInterval);
                runAllListFeatures();
              } else if (_retryCount >= 6) {
                clearInterval(_retryInterval);
              }
            }, 500);
          }

          // Inject filter toggles (with retry if filter bar not rendered yet)
          if (s.show_only_mine || s.show_needs_review) {
            var toggleOk = injectListToggles(username, s);
            if (!toggleOk) {
              var _toggleRetry = 0;
              var _toggleTimer = setInterval(function() {
                _toggleRetry++;
                if (injectListToggles(username, s) || _toggleRetry >= 6) {
                  clearInterval(_toggleTimer);
                }
              }, 500);
            }
          }

          // Re-run on dynamic content (Vue list updates)
          var _observerTimer = null;
          var _enhanceTimer = null;
          var listObserver = new MutationObserver(function() {
            if (_jiraRenderingBadges) return;

            if (s.dim_drafts || s.highlight_own_mrs || s.show_copy_mr) {
              clearTimeout(_enhanceTimer);
              _enhanceTimer = setTimeout(function() {
                applyMrListEnhancements(s, username);
              }, 200);
            }
            clearTimeout(_observerTimer);
            _observerTimer = setTimeout(function() {
              if (s.jira_url) fetchAndRenderJiraStatuses(s.jira_url, s.show_jira_details);
              if (s.show_reviewer_badge && username) fetchAndRenderReviewerBadges(username);
              if (s.show_threads_badge || s.show_size_badge || s.show_conflicts_badge || s.show_approval_badge || s.show_branches) fetchAndRenderMrMeta(s.show_threads_badge, s.show_size_badge, s.show_conflicts_badge, s.show_approval_badge, s.show_branches, s.show_branches_links, username);
              if (s.show_only_mine || s.show_needs_review) injectListToggles(username, s);
            }, 1000);
          });

          // Observe list container (with retry if not found immediately)
          function startListObserver() {
            var listContainer = q(document, SEL.listContainer);
            if (listContainer) {
              listObserver.observe(listContainer, { childList: true, subtree: true });
              return true;
            }
            return false;
          }
          if (!startListObserver()) {
            // Fallback: observe body until list appears
            var _bodyObs = new MutationObserver(function() {
              if (startListObserver()) {
                _bodyObs.disconnect();
              }
            });
            _bodyObs.observe(document.body, { childList: true, subtree: true });
            // Clean up after 10s if list never appears
            setTimeout(function() { _bodyObs.disconnect(); }, 10000);
          }
          window.addEventListener('beforeunload', function() { listObserver.disconnect(); });
        });
      });
    } catch(e) {}
  }

  // =========================================================================
  // MR detail page: Jira badges in title
  // =========================================================================

  if (_isMrDetailPage) {
    try {
      chrome.storage.sync.get({ jira_url: '', jira_ticket_regex: '', show_jira_details: false, skip_confirmations: false }, function(s) {
        if (chrome.runtime.lastError || !s.jira_url) return;
        _jiraUrlStored = s.jira_url;
        _showJiraDetails = !!s.show_jira_details;
        _skipConfirmations = !!s.skip_confirmations;
        setJiraTicketRegex(s.jira_ticket_regex);
        injectMrDetailJiraBadges(s.jira_url);
      });
    } catch(e) {}
  }

  function injectMrDetailJiraBadges(jiraUrl) {
    var titleEl = document.querySelector('.title-container .title, .detail-page-header .title, [data-testid="title-content"]');
    if (!titleEl) {
      // SPA — retry after short delay
      setTimeout(function() { injectMrDetailJiraBadges(jiraUrl); }, 1000);
      return;
    }
    if (titleEl.querySelector('.gl-jira-badge')) return;

    var text = titleEl.textContent.trim();
    _jiraTicketRegex.lastIndex = 0;
    var tickets = text.match(_jiraTicketRegex);
    if (!tickets || !tickets.length) return;

    // Fetch statuses and render badges
    chrome.runtime.sendMessage({
      type: 'fetch-jira-statuses',
      jiraUrl: jiraUrl,
      tickets: tickets,
      showDetails: _showJiraDetails,
    }, function(resp) {
      if (!resp || resp._error || !resp.statuses) return;
      var statuses = resp.statuses;
      tickets.forEach(function(ticket) {
        var status = statuses[ticket];
        if (!status) return;

        if (_showJiraDetails) {
          if (status.typeIcon) {
            var typeEl = document.createElement('img');
            typeEl.className = 'gl-jira-list-icon';
            typeEl.src = status.typeIcon;
            typeEl.title = status.type || '';
            titleEl.appendChild(typeEl);
          }
          if (status.priorityIcon) {
            var prioEl = document.createElement('img');
            prioEl.className = 'gl-jira-list-icon';
            prioEl.src = status.priorityIcon;
            prioEl.title = status.priority || '';
            titleEl.appendChild(prioEl);
          }
        }

        var badge = document.createElement('span');
        badge.className = 'gl-jira-badge ' + getJiraCategoryClass(status.categoryKey, status.name);
        badge.textContent = status.name;
        badge.title = ticket + ': ' + status.name;
        badge.style.cursor = 'pointer';
        badge.dataset.jiraTicket = ticket;
        badge.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          openJiraSidebar(ticket, jiraUrl);
        });
        titleEl.appendChild(badge);
      });
    });
  }

  // =========================================================================
  // Version bump helpers (shared with content.js)
  // =========================================================================

  function bumpVersion(version, strategy) {
    var parts = version.split('.');
    if (strategy === 'major') {
      parts[0] = String(parseInt(parts[0]) + 1);
      for (var i = 1; i < parts.length; i++) parts[i] = '0';
    } else if (strategy === 'minor') {
      if (parts.length < 2) parts.push('0');
      parts[1] = String(parseInt(parts[1]) + 1);
      for (var i = 2; i < parts.length; i++) parts[i] = '0';
    } else {
      parts[parts.length - 1] = String(parseInt(parts[parts.length - 1]) + 1);
    }
    return parts.join('.');
  }

  function getNestedValue(obj, path) {
    var keys = path.split('.');
    var val = obj;
    for (var i = 0; i < keys.length; i++) {
      if (val == null) return undefined;
      val = val[keys[i]];
    }
    return val;
  }

  function setNestedValue(obj, path, value) {
    var keys = path.split('.');
    var target = obj;
    for (var i = 0; i < keys.length - 1; i++) {
      if (target[keys[i]] == null) target[keys[i]] = {};
      target = target[keys[i]];
    }
    target[keys[keys.length - 1]] = value;
  }

  function parseToml(text) {
    var result = {};
    var currentSection = result;
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line[0] === '#') continue;
      var sectionMatch = line.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        var sectionPath = sectionMatch[1].split('.');
        currentSection = result;
        for (var j = 0; j < sectionPath.length; j++) {
          if (!currentSection[sectionPath[j]]) currentSection[sectionPath[j]] = {};
          currentSection = currentSection[sectionPath[j]];
        }
        continue;
      }
      var kvMatch = line.match(/^([^=]+?)\s*=\s*"([^"]*)"$/);
      if (kvMatch) {
        currentSection[kvMatch[1].trim()] = kvMatch[2];
      }
    }
    return result;
  }

  function updateTomlVersion(text, path, newVersion) {
    var keys = path.split('.');
    var versionKey = keys[keys.length - 1];
    var sectionKeys = keys.slice(0, -1);
    var targetSection = sectionKeys.length > 0 ? '[' + sectionKeys.join('.') + ']' : null;
    var lines = text.split('\n');
    var inSection = targetSection === null;
    var regex = new RegExp('^(\\s*' + versionKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*)"[^"]*"');
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (trimmed.match(/^\[/)) {
        inSection = targetSection && trimmed === targetSection;
      }
      if (inSection && regex.test(lines[i])) {
        lines[i] = lines[i].replace(regex, '$1"' + newVersion + '"');
        return lines.join('\n');
      }
    }
    throw new Error('Could not find "' + path + '" in TOML file');
  }

  // =========================================================================
  // Cherry-pick to multiple branches (commits page)
  // =========================================================================

  function isCommitsPage() {
    return /\/-\/commits\//.test(window.location.pathname) || /\/-\/repository\/commits\//.test(window.location.pathname);
  }

  function isCommitDetailPage() {
    // Matches /-/commit/<sha> (modern) and /commit/<sha> (legacy GitLab < 12.x)
    return /\/commit\/[0-9a-f]{7,40}\b/.test(window.location.pathname) && !/\/commits\//.test(window.location.pathname);
  }

  if (isCommitsPage() || isCommitDetailPage()) {
    try {
      chrome.storage.sync.get({ show_cherry_pick: true, cherry_pick_branches: [], cherry_pick_create_mr: true, cherry_pick_smart_fallback: true, cherry_pick_bump_version: false, versionFile: 'package.json', versionPath: 'version', versionStrategy: 'patch', versionCommitTemplate: 'fix: bump version to {version}' }, function(s) {
        if (chrome.runtime.lastError || s.show_cherry_pick === false) return;

        var projectPath = (function() {
          var m = window.location.pathname.match(/^\/([^/]+(?:\/[^/]+)*?)\/-\//);
          return m ? m[1] : null;
        })();
        if (!projectPath) return;
        var encodedProject = encodeURIComponent(projectPath);

        function findCommitShaGroups() {
          // Strategy 1: known CSS classes / data-testid (old + new GitLab)
          var groups = qAll(document, SEL.commitShaGroup);
          if (groups.length) return Array.prototype.slice.call(groups);

          // Strategy 2: find clipboard buttons with 40-char hex SHA,
          // then return their parent group (works even if classes change)
          var result = [];
          var seen = [];
          var clipboardEls = qAll(document, '[data-clipboard-text]');
          for (var i = 0; i < clipboardEls.length; i++) {
            var text = clipboardEls[i].getAttribute('data-clipboard-text') || '';
            if (/^[0-9a-f]{7,40}$/.test(text)) {
              var group = clipboardEls[i].closest('.btn-group, .commit-sha-group, .gl-button-group') || clipboardEls[i].parentElement;
              if (group && seen.indexOf(group) === -1) {
                seen.push(group);
                result.push(group);
              }
            }
          }
          return result;
        }

        function injectCherryPickButtons() {
          var shaGroups = findCommitShaGroups();
          if (!shaGroups.length) return;

          shaGroups.forEach(function(group) {
            if (group.querySelector('.gl-cherry-pick-btn')) return;

            var shaEl = q(group, SEL.commitSha);
            var sha = shaEl ? (shaEl.getAttribute('data-clipboard-text') || shaEl.textContent.trim()) : '';
            if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) return;

            var row = qUp(group, SEL.commitRow) || group.parentElement;
            var msgEl = row ? q(row, SEL.commitMsg) : null;
            var commitMsg = msgEl ? msgEl.textContent.trim() : '';

            var btn = document.createElement('button');
            btn.className = 'gl-cherry-pick-btn gl-button btn btn-icon btn-md btn-default';
            btn.title = msg('cherryPickTitle');
            btn.setAttribute('aria-label', msg('cherryPickTitle'));
            btn.type = 'button';
            btn.innerHTML = '<svg class="s16 gl-icon gl-button-icon" viewBox="0 0 16 16"><circle cx="8" cy="4" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M8 6v4"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M4 8h8"/></svg>';
            btn.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              openCherryPickModal(sha, commitMsg, s);
            });
            group.appendChild(btn);
          });
        }

        function openCherryPickModal(sha, commitMsg, settings) {
          var savedBranches = settings.cherry_pick_branches || [];
          var defaultCreateMr = settings.cherry_pick_create_mr !== false;
          var defaultSmartFallback = settings.cherry_pick_smart_fallback !== false;
          var defaultBumpVersion = settings.cherry_pick_bump_version || false;
          var existing = document.querySelector('.gl-cherry-pick-overlay');
          if (existing) existing.remove();

          var overlay = document.createElement('div');
          overlay.className = 'gl-cherry-pick-overlay';

          var modal = document.createElement('div');
          modal.className = 'gl-cherry-pick-modal';

          var shortSha = sha.substring(0, 8);

          modal.innerHTML =
            '<div class="gl-cherry-pick-header">' +
              '<span class="gl-cherry-pick-header-title">' + escHtml(msg('cherryPickTitle')) + ': ' + escHtml(shortSha) + '</span>' +
              '<button class="gl-cherry-pick-close gl-button btn btn-icon btn-sm btn-default btn-icon-only" type="button" aria-label="Close">' +
                '<svg class="s16 gl-icon gl-button-icon" viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" fill="currentColor"/></svg>' +
              '</button>' +
            '</div>' +
            '<div class="gl-cherry-pick-commit-msg">' + escHtml(commitMsg || sha) + '</div>' +
            '<div class="gl-cherry-pick-input-row">' +
              '<input type="text" class="gl-cherry-pick-input gl-form-input form-control" placeholder="' + escHtml(msg('cherryPickBranchPlaceholder')) + '">' +
              '<button class="gl-button btn btn-default btn-md gl-cherry-pick-add-btn" type="button">' + escHtml(msg('cherryPickBranchAdd')) + '</button>' +
            '</div>' +
            '<div class="gl-cherry-pick-branches"></div>' +
            '<label class="gl-cherry-pick-mr-toggle gl-form-checkbox">' +
              '<input type="checkbox" class="gl-cherry-pick-mr-checkbox"' + (defaultCreateMr ? ' checked' : '') + '>' +
              '<span>' + escHtml(msg('cherryPickCreateMr')) + '</span>' +
            '</label>' +
            '<label class="gl-cherry-pick-mr-toggle gl-form-checkbox">' +
              '<input type="checkbox" class="gl-cherry-pick-fallback-checkbox"' + (defaultSmartFallback ? ' checked' : '') + '>' +
              '<span>' + escHtml(msg('cherryPickSmartFallback')) + '</span>' +
            '</label>' +
            '<label class="gl-cherry-pick-mr-toggle gl-form-checkbox">' +
              '<input type="checkbox" class="gl-cherry-pick-bump-checkbox"' + (defaultBumpVersion ? ' checked' : '') + '>' +
              '<span>' + escHtml(msg('cherryPickBumpVersion')) + '</span>' +
            '</label>' +
            '<div class="gl-cherry-pick-footer">' +
              '<button class="gl-button btn btn-default btn-md gl-cherry-pick-cancel" type="button">' + escHtml(msg('cherryPickClose')) + '</button>' +
              '<button class="gl-button btn btn-confirm btn-md gl-cherry-pick-start" type="button">' + escHtml(msg('cherryPickStart')) + '</button>' +
            '</div>';

          overlay.appendChild(modal);

          var input = modal.querySelector('.gl-cherry-pick-input');
          var addBtn = modal.querySelector('.gl-cherry-pick-add-btn');
          var branchList = modal.querySelector('.gl-cherry-pick-branches');
          var startBtn = modal.querySelector('.gl-cherry-pick-start');
          var closeBtn = modal.querySelector('.gl-cherry-pick-close');
          var cancelBtn = modal.querySelector('.gl-cherry-pick-cancel');
          var mrCheckbox = modal.querySelector('.gl-cherry-pick-mr-checkbox');
          var fallbackCheckbox = modal.querySelector('.gl-cherry-pick-fallback-checkbox');
          var bumpCheckbox = modal.querySelector('.gl-cherry-pick-bump-checkbox');

          var branches = [];

          function addBranch(name) {
            name = name.trim();
            if (!name) return;
            for (var i = 0; i < branches.length; i++) {
              if (branches[i].name === name) return;
            }
            branches.push({ name: name, status: 'pending', error: '' });
            renderBranches();
          }

          function removeBranch(idx) {
            if (branches[idx] && branches[idx].status !== 'in_progress') {
              branches.splice(idx, 1);
              renderBranches();
            }
          }

          function renderBranches() {
            branchList.innerHTML = '';
            branches.forEach(function(b, i) {
              var row = document.createElement('div');
              row.className = 'gl-cherry-pick-branch-row gl-cherry-pick-status-' + b.status;
              var statusIcon = '';
              var _svgPending = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
              var _svgProgress = '<svg viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M8 14.5a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM8 16A8 8 0 108 0a8 8 0 000 16z" clip-rule="evenodd"/><path fill="currentColor" d="M8 4a.75.75 0 01.75.75v2.5h2.5a.75.75 0 010 1.5h-3.25A.75.75 0 017.25 8V4.75A.75.75 0 018 4z"/></svg>';
              var _svgSuccess = '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 8a8 8 0 1116 0A8 8 0 010 8zm11.7-1.7a1 1 0 00-1.4-1.42L7 8.17 5.7 6.88a1 1 0 00-1.4 1.42l2 2a1 1 0 001.4 0l4-4z" fill="currentColor"/></svg>';
              var _svgError = '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 8a8 8 0 1116 0A8 8 0 010 8zm5.3-2.3a.75.75 0 00-1.06 1.06L6.44 8 4.24 10.24a.75.75 0 001.06 1.06L7.5 9.06l2.2 2.24a.75.75 0 001.06-1.06L8.56 8l2.2-2.24a.75.75 0 00-1.06-1.06L7.5 6.94 5.3 4.7z" fill="currentColor"/></svg>';
              if (b.status === 'pending') statusIcon = '<span class="gl-cherry-pick-status-icon pending">' + _svgPending + '</span>';
              else if (b.status === 'in_progress') statusIcon = '<span class="gl-cherry-pick-status-icon in-progress">' + _svgProgress + '</span>';
              else if (b.status === 'success') statusIcon = '<span class="gl-cherry-pick-status-icon success">' + _svgSuccess + '</span>';
              else if (b.status === 'error') statusIcon = '<span class="gl-cherry-pick-status-icon error" title="' + escHtml(b.error) + '">' + _svgError + '</span>';

              var mrLink = (b.status === 'success' && b.mrUrl) ? '<a href="' + escHtml(b.mrUrl) + '" target="_blank" class="gl-cherry-pick-mr-link">MR</a>' : '';

              row.innerHTML =
                statusIcon +
                '<span class="gl-cherry-pick-branch-name">' + escHtml(b.name) + '</span>' +
                (b.status === 'error' ? '<span class="gl-cherry-pick-error-text">' + escHtml(b.error) + '</span>' : '') +
                mrLink +
                '<button class="gl-cherry-pick-remove" data-idx="' + i + '" title="' + escHtml(msg('cherryPickRemove')) + '">&times;</button>';
              branchList.appendChild(row);
            });

            branchList.querySelectorAll('.gl-cherry-pick-remove').forEach(function(btn) {
              btn.addEventListener('click', function() {
                removeBranch(parseInt(btn.dataset.idx));
              });
            });
          }

          (savedBranches || []).forEach(function(b) { addBranch(b); });

          addBtn.addEventListener('click', function() {
            addBranch(input.value);
            input.value = '';
            input.focus();
          });

          input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              addBranch(input.value);
              input.value = '';
            }
          });

          var _running = false;

          startBtn.addEventListener('click', function() {
            if (_running) return;
            var hasPending = false;
            for (var k = 0; k < branches.length; k++) {
              if (branches[k].status === 'pending' || branches[k].status === 'error') { hasPending = true; break; }
            }
            if (!hasPending) return;

            _running = true;
            startBtn.disabled = true;
            startBtn.textContent = msg('cherryPickInProgress');

            branches.forEach(function(b) {
              if (b.status === 'error') { b.status = 'pending'; b.error = ''; }
            });
            renderBranches();

            // Fallback: replay commit via Commits API, excluding version file
            function doFallbackCommit(commitBranch, targetForBump) {
              return Promise.all([
                api('GET', '/projects/' + encodedProject + '/repository/commits/' + sha),
                api('GET', '/projects/' + encodedProject + '/repository/commits/' + sha + '/diff')
              ]).then(function(results) {
                var commitInfo = results[0];
                var diffs = results[1];
                var versionFile = settings.versionFile || 'package.json';

                // Filter out version file
                var filtered = diffs.filter(function(d) { return d.new_path !== versionFile && d.old_path !== versionFile; });
                if (!filtered.length) throw new Error('No files left after excluding ' + versionFile);

                // Build actions from diffs
                var filePromises = filtered.map(function(d) {
                  if (d.deleted_file) {
                    return Promise.resolve({ action: 'delete', file_path: d.new_path });
                  }
                  // For new or updated files, get content from the original commit
                  return api('GET', '/projects/' + encodedProject + '/repository/files/' + encodeURIComponent(d.new_path) + '?ref=' + sha)
                    .then(function(file) {
                      return {
                        action: d.new_file ? 'create' : 'update',
                        file_path: d.new_path,
                        content: file.content,
                        encoding: 'base64'
                      };
                    });
                });

                return Promise.all(filePromises).then(function(actions) {
                  // Optionally bump version in the same commit
                  if (!bumpCheckbox.checked) {
                    var commitMsg = (commitInfo.message || '') + '\n\n(cherry picked from commit ' + sha + ')';
                    return api('POST', '/projects/' + encodedProject + '/repository/commits', {
                      branch: commitBranch,
                      commit_message: commitMsg,
                      actions: actions,
                      author_name: commitInfo.author_name,
                      author_email: commitInfo.author_email
                    });
                  }

                  var vFile = settings.versionFile || 'package.json';
                  var vPath = settings.versionPath || 'version';
                  var strategy = settings.versionStrategy || 'patch';

                  return api('GET', '/projects/' + encodedProject + '/repository/files/' + encodeURIComponent(vFile) + '?ref=' + encodeURIComponent(targetForBump))
                    .then(function(file) {
                      var rawContent = decodeURIComponent(escape(atob(file.content)));
                      var currentVersion, newContent, newVersion;
                      var isToml = vFile.indexOf('.toml') !== -1;
                      var isPlainText = vFile.indexOf('.txt') !== -1;

                      if (isPlainText) {
                        currentVersion = rawContent.trim();
                        newVersion = bumpVersion(currentVersion, strategy);
                        newContent = newVersion + '\n';
                      } else if (isToml) {
                        var parsed = parseToml(rawContent);
                        currentVersion = getNestedValue(parsed, vPath);
                        if (!currentVersion) throw new Error('Version not found at ' + vPath);
                        newVersion = bumpVersion(currentVersion, strategy);
                        newContent = updateTomlVersion(rawContent, vPath, newVersion);
                      } else {
                        var json = JSON.parse(rawContent);
                        currentVersion = getNestedValue(json, vPath);
                        if (!currentVersion) throw new Error('Version not found at ' + vPath);
                        newVersion = bumpVersion(currentVersion, strategy);
                        setNestedValue(json, vPath, newVersion);
                        newContent = JSON.stringify(json, null, 2) + '\n';
                      }

                      // Add version file update to the same actions array
                      actions.push({
                        action: 'update',
                        file_path: vFile,
                        content: btoa(unescape(encodeURIComponent(newContent))),
                        encoding: 'base64'
                      });

                      var commitMsg = (commitInfo.message || '') + '\n\n(cherry picked from commit ' + sha + ')';
                      return api('POST', '/projects/' + encodedProject + '/repository/commits', {
                        branch: commitBranch,
                        commit_message: commitMsg,
                        actions: actions,
                        author_name: commitInfo.author_name,
                        author_email: commitInfo.author_email
                      });
                    });
                });
              });
            }

            var idx = 0;
            function processNext() {
              while (idx < branches.length && branches[idx].status !== 'pending') idx++;
              if (idx >= branches.length) {
                _running = false;
                startBtn.disabled = false;
                startBtn.textContent = msg('cherryPickStart');
                var successCount = 0;
                var errorCount = 0;
                branches.forEach(function(b) {
                  if (b.status === 'success') successCount++;
                  if (b.status === 'error') errorCount++;
                });
                if (errorCount === 0 && successCount > 0) {
                  var toastMsg;
                  try { toastMsg = chrome.i18n.getMessage('cherryPickAllSuccess', [String(successCount)]); } catch(e) { toastMsg = ''; }
                  if (!toastMsg) toastMsg = 'Cherry-picked to ' + successCount + ' branches';
                  showToast(toastMsg, 'success');
                }
                return;
              }

              branches[idx].status = 'in_progress';
              renderBranches();

              var createMr = mrCheckbox.checked;
              var useFallback = fallbackCheckbox.checked;
              var targetBranch = branches[idx].name;
              var currentIdx = idx;

              // Determine the branch to commit into
              var commitBranch = targetBranch;
              var mrBranch = null;
              if (createMr) {
                mrBranch = 'cherry-pick-' + shortSha + '-into-' + targetBranch.replace(/\//g, '-');
                commitBranch = mrBranch;
              }

              // Step 1: create branch if MR mode
              var branchPromise = createMr
                ? api('POST', '/projects/' + encodedProject + '/repository/branches', { branch: mrBranch, ref: targetBranch })
                : Promise.resolve();

              branchPromise.then(function() {
                // Step 2: try cherry-pick
                return api('POST', '/projects/' + encodedProject + '/repository/commits/' + sha + '/cherry_pick', {
                  branch: commitBranch
                });
              }).catch(function(cherryPickErr) {
                // Cherry-pick failed — try fallback if enabled
                if (!useFallback) throw cherryPickErr;

                // If MR mode and branch was already created, delete it and recreate
                var cleanupPromise = createMr
                  ? api('DELETE', '/projects/' + encodedProject + '/repository/branches/' + encodeURIComponent(mrBranch)).catch(function() {})
                      .then(function() { return api('POST', '/projects/' + encodedProject + '/repository/branches', { branch: mrBranch, ref: targetBranch }); })
                  : Promise.resolve();

                return cleanupPromise.then(function() {
                  return doFallbackCommit(commitBranch, targetBranch);
                });
              }).then(function() {
                // Step 3: create MR if requested
                if (!createMr) return;
                return api('POST', '/projects/' + encodedProject + '/merge_requests', {
                  source_branch: mrBranch,
                  target_branch: targetBranch,
                  title: 'Cherry-pick ' + shortSha + ' into ' + targetBranch,
                  remove_source_branch: true
                });
              }).then(function(mr) {
                branches[currentIdx].status = 'success';
                if (mr && mr.web_url) branches[currentIdx].mrUrl = mr.web_url;
                renderBranches();
                idx++;
                processNext();
              }).catch(function(err) {
                branches[currentIdx].status = 'error';
                branches[currentIdx].error = err.message || String(err);
                renderBranches();
                idx++;
                processNext();
              });
            }

            processNext();
          });

          function closeModal() {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
          }

          function onKey(e) {
            if (e.key === 'Escape') closeModal();
          }

          closeBtn.addEventListener('click', closeModal);
          cancelBtn.addEventListener('click', closeModal);
          overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeModal();
          });
          document.addEventListener('keydown', onKey);

          document.body.appendChild(overlay);
          input.focus();
        }

        function showToast(message, type) {
          var existing = document.querySelectorAll('.gl-mr-actions-toast');
          existing.forEach(function(el) { el.remove(); });
          var toast = document.createElement('div');
          toast.className = 'gl-mr-actions-toast ' + type;
          toast.textContent = message;
          document.body.appendChild(toast);
          setTimeout(function() { try { toast.remove(); } catch(e) {} }, 5000);
        }

        if (isCommitDetailPage()) {
          // Single commit page — inject button in page header next to Options dropdown

          function findCommitHeaderContainer() {
            // Strategy 1: page-content-header (modern GitLab 15+)
            var header = document.querySelector('.page-content-header');
            if (header) return header;

            // Strategy 2: tree-controls (GitLab 13-14, holds Browse files + Options)
            var treeControls = document.querySelector('.tree-controls');
            if (treeControls) return treeControls;

            // Strategy 3: commit-actions area
            var commitActions = document.querySelector('.commit-actions');
            if (commitActions) return commitActions;

            // Strategy 4: detail-page-header actions (generic GitLab header)
            var detailHeader = document.querySelector('.detail-page-header .detail-page-header-actions, .detail-page-header');
            if (detailHeader) return detailHeader;

            // Strategy 5: find the Options dropdown button and use its parent
            var optionsBtn = document.querySelector(
              '.dropdown-toggle[data-toggle="dropdown"], ' +
              '.gl-new-dropdown-toggle, ' +
              'button.dropdown-toggle'
            );
            if (optionsBtn) {
              var group = optionsBtn.closest('.btn-group, .gl-button-group, .dropdown');
              return (group && group.parentElement) ? group.parentElement : null;
            }

            return null;
          }

          function injectCherryPickHeaderBtn() {
            if (document.querySelector('.gl-cherry-pick-detail-btn')) return;

            var container = findCommitHeaderContainer();
            if (!container) return;

            // Extract SHA from URL (supports /-/commit/ and legacy /commit/)
            var shaMatch = window.location.pathname.match(/\/commit\/([0-9a-f]{7,40})\b/);
            var sha = shaMatch ? shaMatch[1] : '';
            if (!sha) return;

            // Extract commit message from page
            var commitMsgEl = document.querySelector(
              '.commit-title, [data-testid="commit-title"], .page-title, ' +
              '.commit-box .commit-title, .page-title-holder .title'
            );
            var commitMsg = commitMsgEl ? commitMsgEl.textContent.trim() : '';

            var btn = document.createElement('button');
            btn.className = 'gl-cherry-pick-detail-btn gl-button btn btn-default btn-md';
            btn.type = 'button';
            btn.title = msg('cherryPickToBranches');
            btn.innerHTML =
              '<svg class="s16 gl-icon gl-button-icon" viewBox="0 0 16 16">' +
                '<circle cx="8" cy="4" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
                '<circle cx="8" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
                '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M8 6v4"/>' +
                '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M4 8h8"/>' +
              '</svg>' +
              '<span class="gl-button-text">' + escHtml(msg('cherryPickToBranches')) + '</span>';
            btn.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              openCherryPickModal(sha, commitMsg, s);
            });

            container.appendChild(btn);
          }

          // Header may be rendered by Vue, observe + retry
          var _cpDetailTimer = null;
          var _cpDetailAttempts = 0;
          var cpDetailObserver = new MutationObserver(function() {
            if (document.querySelector('.gl-cherry-pick-detail-btn')) return;
            clearTimeout(_cpDetailTimer);
            _cpDetailTimer = setTimeout(injectCherryPickHeaderBtn, 200);
          });
          cpDetailObserver.observe(document.body, { childList: true, subtree: true });
          window.addEventListener('beforeunload', function() { cpDetailObserver.disconnect(); });

          // Retry polling for slow-rendering pages (up to 3s)
          (function pollHeader() {
            if (document.querySelector('.gl-cherry-pick-detail-btn') || _cpDetailAttempts > 6) return;
            _cpDetailAttempts++;
            if (!findCommitHeaderContainer()) {
              setTimeout(pollHeader, 500);
            } else {
              injectCherryPickHeaderBtn();
            }
          })();
        } else {
          // Commits list page — inject buttons next to each commit SHA
          injectCherryPickButtons();

          var _cpTimer = null;
          var cpObserver = new MutationObserver(function() {
            clearTimeout(_cpTimer);
            _cpTimer = setTimeout(injectCherryPickButtons, 300);
          });
          cpObserver.observe(document.body, { childList: true, subtree: true });
          window.addEventListener('beforeunload', function() { cpObserver.disconnect(); });
        }
      });
    } catch(e) {}
  }

  // =========================================================================
  // Collapse top bars (#63)
  // =========================================================================

  try {
    chrome.storage.sync.get({ collapse_bars: false }, function(s) {
      if (chrome.runtime.lastError || !s.collapse_bars) return;

      var collapsed = sessionStorage.getItem('gl_mr_ext_bars_collapsed') === '1';

      function applyCollapse(state) {
        document.body.classList.toggle('gl-mr-ext-bars-collapsed', state);
        sessionStorage.setItem('gl_mr_ext_bars_collapsed', state ? '1' : '0');
      }

      function injectCollapseBtn() {
        if (document.querySelector('.gl-mr-ext-collapse-btn')) return;
        var btn = document.createElement('button');
        btn.className = 'gl-mr-ext-collapse-btn';
        btn.title = msg('collapseTopBars');
        btn.innerHTML = '<svg viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M3 10l5-5 5 5"/></svg>';
        btn.addEventListener('click', function() {
          collapsed = !collapsed;
          btn.querySelector('svg').style.transform = collapsed ? 'rotate(180deg)' : '';
          applyCollapse(collapsed);
        });
        document.body.appendChild(btn);
        applyCollapse(collapsed);
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectCollapseBtn);
      } else {
        injectCollapseBtn();
      }
    });
  } catch(e) {}

  // =========================================================================
  // Hide UI sections (#62)
  // =========================================================================

  try {
    chrome.storage.sync.get({ hide_right_sidebar: false }, function(s) {
      if (chrome.runtime.lastError) return;
      if (s.hide_right_sidebar && /\/-\/merge_requests\/\d+/.test(window.location.pathname)) {
        document.body.classList.add('gl-mr-ext-hide-right-sidebar');
      }
    });
  } catch(e) {}

  // =========================================================================
  // Command Palette (Cmd+K)
  // =========================================================================

  try {
    chrome.storage.sync.get({ show_cmd_palette: true, show_standup: true }, function(s) {
      if (chrome.runtime.lastError || !s.show_cmd_palette) return;

      var _paletteOpen = false;
      var _paletteCollapsed = (function() {
        try { return JSON.parse(sessionStorage.getItem('gl-cmd-palette-collapsed')) || {}; } catch(e) { return {}; }
      })();
      var _standupEnabled = !!s.show_standup;

      // File search
      var _defaultBranch = '';
      var _fileSearchReqId = 0;

      function fetchDefaultBranch(projectPath) {
        if (_defaultBranch) return;
        api('GET', '/projects/' + encodeURIComponent(projectPath))
          .then(function(proj) { _defaultBranch = proj.default_branch || 'main'; })
          .catch(function() { _defaultBranch = 'main'; });
      }

      function searchFiles(projectPath, query, cb) {
        var reqId = ++_fileSearchReqId;
        var encodedPath = encodeURIComponent(projectPath);
        api('GET', '/projects/' + encodedPath + '/search?scope=blobs&search=' + encodeURIComponent(query) + '&per_page=20')
          .then(function(results) {
            if (reqId !== _fileSearchReqId) return;
            // Deduplicate by file path
            var seen = {};
            var files = [];
            results.forEach(function(item) {
              if (item.filename && !seen[item.filename]) {
                seen[item.filename] = true;
                files.push(item.filename);
              }
            });
            cb(files);
          })
          .catch(function() {
            if (reqId !== _fileSearchReqId) return;
            cb([]);
          });
      }

      function getProjectPath() {
        // Try /-/ pattern first (most GitLab pages)
        var m = window.location.pathname.match(/^\/([^/]+(?:\/[^/]+)*?)\/-\//);
        if (m) return m[1];
        // Fallback: detect from GitLab sidebar or body data
        var projectLink = document.querySelector('[data-testid="sidebar-menu-link"][href*="/-/"]');
        if (projectLink) {
          var hm = projectLink.getAttribute('href').match(/^\/([^/]+(?:\/[^/]+)*?)\/-\//);
          if (hm) return hm[1];
        }
        // Fallback: body data-project-full-path
        var body = document.body;
        if (body && body.dataset.projectFullPath) return body.dataset.projectFullPath;
        // Fallback: breadcrumbs / header meta
        var breadcrumb = document.querySelector('[data-testid="breadcrumb-links"] a[href*="/-/"], .breadcrumbs-list a[href*="/-/"]');
        if (breadcrumb) {
          var bm = breadcrumb.getAttribute('href').match(/^\/([^/]+(?:\/[^/]+)*?)\/-\//);
          if (bm) return bm[1];
        }
        // Last resort: 2-segment path like /namespace/project
        var pm = window.location.pathname.match(/^\/([^/]+\/[^/]+)\/?$/);
        if (pm) return pm[1];
        return '';
      }

      function parseSidebarLink(a) {
        var href = a.getAttribute('href');
        if (!href) return null;
        var clone = a.cloneNode(true);
        // Remove badges, counts, avatars
        var junk = clone.querySelectorAll('[class*="badge"], [class*="count"], .badge, .count, span[aria-label], [class*="avatar"], img, .gl-avatar');
        junk.forEach(function(b) { b.remove(); });
        var text = (clone.textContent || '').trim();
        if (!text) return null;
        // Find parent section name by walking up the DOM
        var section = '';
        var el = a.parentElement;
        while (el && !el.matches('[data-testid="super-sidebar"], .sidebar-top-level-items, body')) {
          // Super Sidebar: sections are li/div with a direct child <button> (expander)
          var sBtn = el.querySelector(':scope > button');
          if (sBtn && sBtn !== a) {
            var sClone = sBtn.cloneNode(true);
            var sJunk = sClone.querySelectorAll('[class*="badge"], [class*="count"], [class*="avatar"], img, svg, .gl-avatar');
            sJunk.forEach(function(b) { b.remove(); });
            var sTxt = (sClone.textContent || '').trim();
            if (sTxt && sTxt !== text) { section = sTxt; break; }
          }
          // Old sidebar: top-level li > a is section header
          var sLink = el.querySelector(':scope > a');
          if (sLink && sLink !== a && el.querySelector('.sidebar-sub-level-items')) {
            var lClone = sLink.cloneNode(true);
            var lJunk = lClone.querySelectorAll('[class*="badge"], [class*="count"], [class*="avatar"], img, svg');
            lJunk.forEach(function(b) { b.remove(); });
            var lTxt = (lClone.textContent || '').trim();
            if (lTxt && lTxt !== text) { section = lTxt; break; }
          }
          el = el.parentElement;
        }
        var label = section && section !== text ? section + ' - ' + text : text;
        return { label: label, href: href };
      }

      function getSidebarLinks() {
        var pinned = [];
        var nav = [];
        var seenHrefs = {};

        // Pinned items
        var pinEls = document.querySelectorAll('[data-testid="pinned-nav-items"] a[href]');
        pinEls.forEach(function(a) {
          var item = parseSidebarLink(a);
          if (item) {
            pinned.push(item);
            seenHrefs[item.href.split('?')[0]] = true;
          }
        });

        // All other sidebar links (skip pinned duplicates)
        var navEls = document.querySelectorAll('[data-testid="super-sidebar"] nav a[href], [data-testid="super-sidebar"] [data-testid="nav-item"] a[href], .sidebar-top-level-items > li > a[href], .sidebar-sub-level-items a[href]');
        navEls.forEach(function(a) {
          var item = parseSidebarLink(a);
          if (!item) return;
          var cleanHref = item.href.split('?')[0];
          if (seenHrefs[cleanHref]) return;
          seenHrefs[cleanHref] = true;
          nav.push(item);
        });

        return { pinned: pinned, nav: nav };
      }

      function isCurrentPath(path) {
        var current = window.location.pathname.replace(/\/$/, '');
        var target = path.replace(/\/$/, '');
        return current === target;
      }

      function buildCommands() {
        var cmds = [];
        var projectPath = getProjectPath();
        var currentPath = window.location.pathname;
        var isMrDetail = /\/-\/merge_requests\/\d+/.test(currentPath);

        // Read all sidebar links
        var sidebar = getSidebarLinks();
        var hasSidebar = sidebar.pinned.length > 0 || sidebar.nav.length > 0;

        // Pinned items first
        sidebar.pinned.forEach(function(pin, i) {
          var pinPath = pin.href.split('?')[0];
          if (!isCurrentPath(pinPath)) {
            cmds.push({ id: 'pin-' + i, label: pin.label, group: msg('cmdGroupPinned'), icon: 'pin', action: function() { window.location.href = pin.href; } });
          }
        });

        // All other sidebar navigation
        sidebar.nav.forEach(function(item, i) {
          var itemPath = item.href.split('?')[0];
          if (!isCurrentPath(itemPath)) {
            cmds.push({ id: 'nav-' + i, label: item.label, group: msg('cmdGroupNav'), icon: 'nav', action: function() { window.location.href = item.href; } });
          }
        });

        // Fallback navigation if sidebar not found (old GitLab versions)
        if (!hasSidebar && projectPath) {
          var fallbackNav = [
            { label: msg('cmdNavRepo'),      path: '/' + projectPath },
            { label: msg('cmdNavMrs'),       path: '/' + projectPath + '/-/merge_requests' },
            { label: msg('cmdNavIssues'),    path: '/' + projectPath + '/-/issues' },
            { label: msg('cmdNavPipelines'), path: '/' + projectPath + '/-/pipelines' },
            { label: msg('cmdNavBranches'),  path: '/' + projectPath + '/-/branches' },
            { label: msg('cmdNavTags'),      path: '/' + projectPath + '/-/tags' },
            { label: msg('cmdNavCommits'),   path: '/' + projectPath + '/-/commits' },
            { label: msg('cmdNavWiki'),      path: '/' + projectPath + '/-/wikis' },
            { label: msg('cmdNavSnippets'),  path: '/' + projectPath + '/-/snippets' },
            { label: msg('cmdNavSettings'),  path: '/' + projectPath + '/-/settings' },
          ];
          fallbackNav.forEach(function(item, i) {
            if (!isCurrentPath(item.path)) {
              cmds.push({ id: 'nav-' + i, label: item.label, group: msg('cmdGroupNav'), icon: 'nav', action: function() { window.location.href = item.path; } });
            }
          });
        }

        // Copy project path
        if (projectPath) {
          cmds.push({ id: 'copy-path', label: msg('cmdCopyPath'), hint: projectPath, group: msg('cmdGroupNav'), icon: 'copy', action: function() { navigator.clipboard.writeText(projectPath); } });
        }

        // MR actions (only on MR detail page — read available actions from content.js)
        if (isMrDetail && window.__glMrActionsLoaded && window.__glMrPaletteActions) {
          window.__glMrPaletteActions.forEach(function(a) {
            cmds.push({ id: a.id, label: a.label, group: msg('cmdGroupMr'), icon: a.icon || 'action', action: function() {
              window.postMessage({ type: 'gl-mr-ext-palette-action', actionId: a.id }, '*');
            }});
          });
        }

        // Extension commands
        cmds.push({ id: 'ext-settings', label: msg('cmdExtSettings'), group: msg('cmdGroupExt'), icon: 'settings', action: function() { chrome.runtime.sendMessage({ type: 'open-options' }); } });

        // Standup
        if (_standupEnabled) {
          cmds.push({ id: 'ext-standup', label: msg('cmdExtStandup'), group: msg('cmdGroupExt'), icon: 'standup', action: function() { openStandupModal(); } });
        }

        return cmds;
      }

      function getIconSvg(icon) {
        var icons = {
          mr:       '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M5 3v10M11 3v10M5 8h6"/>',
          issue:    '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M8 5v3.5l2.5 1.5"/>',
          pipe:     '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M2 8h4M10 8h4"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/>',
          branch:   '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M5 3v6c0 2 2 3 4 3h2M11 9v4M11 9l-2-2M11 9l2-2"/>',
          repo:     '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M3 12V4a1 1 0 011-1h8a1 1 0 011 1v8M3 12h10a1 1 0 001-1V4M3 12a1 1 0 001 1h9"/>',
          copy:     '<rect x="5" y="5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" d="M11 5V4a1 1 0 00-1-1H4a1 1 0 00-1 1v6a1 1 0 001 1h1"/>',
          action:   '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M13 3L6.5 9.5M13 3h-4M13 3v4M6 4H4a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1v-2"/>',
          settings: '<circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4"/>',
          standup:  '<rect x="3" y="2" width="10" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6 5h4M6 8h4M6 11h2"/>',
          tag:      '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M2 8.5V3.5a1 1 0 011-1h5l5.5 5.5-5 5z"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor"/>',
          commit:   '<circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M8 2v3M8 11v3"/>',
          wiki:     '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M3 13V3h4l1 2h5v8z"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6 7h4M6 9.5h3"/>',
          snippet:  '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M5 4l-3 4 3 4M11 4l3 4-3 4M9 3L7 13"/>',
          pin:      '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M5 3l1 5H4l4 6V9.5h1L11 3z"/>',
          nav:      '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M5 4l4 4-4 4"/>',
          file:     '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M9 2v4h4"/>',
        };
        return '<svg viewBox="0 0 16 16" class="gl-cmd-palette-item-icon">' + (icons[icon] || icons.action) + '</svg>';
      }

      function openPalette() {
        if (_paletteOpen) return;
        _paletteOpen = true;

        var projectPath = getProjectPath();
        if (projectPath) fetchDefaultBranch(projectPath);

        var cmds = buildCommands();
        var selectedIdx = 0;
        var filtered = cmds.slice();

        var overlay = document.createElement('div');
        overlay.className = 'gl-cmd-palette-overlay';

        var modal = document.createElement('div');
        modal.className = 'gl-cmd-palette';

        modal.innerHTML =
          '<div class="gl-cmd-palette-input-wrap">' +
            '<svg viewBox="0 0 16 16" class="gl-cmd-palette-icon"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M10.5 10.5l3 3"/></svg>' +
            '<input type="text" class="gl-cmd-palette-input" placeholder="' + escHtml(msg('cmdPlaceholder')) + '">' +
          '</div>' +
          '<div class="gl-cmd-palette-list"></div>' +
          '<div class="gl-cmd-palette-footer">' +
            '<span><kbd>&uarr;&darr;</kbd> ' + escHtml(msg('cmdFooterNavigate')) + '</span>' +
            '<span><kbd>Enter</kbd> ' + escHtml(msg('cmdFooterSelect')) + '</span>' +
            '<span><kbd>Esc</kbd> ' + escHtml(msg('cmdFooterClose')) + '</span>' +
          '</div>';

        overlay.appendChild(modal);

        var input = modal.querySelector('.gl-cmd-palette-input');
        var listEl = modal.querySelector('.gl-cmd-palette-list');

        var isSearching = false;

        function renderList() {
          var html = '';
          var lastGroup = '';
          var groupItems = {};
          // Group items
          filtered.forEach(function(cmd, i) {
            var g = cmd.group || '';
            if (!groupItems[g]) groupItems[g] = [];
            groupItems[g].push({ cmd: cmd, idx: i });
          });
          // Render groups in order
          var renderedGroups = [];
          filtered.forEach(function(cmd) {
            var g = cmd.group || '';
            if (renderedGroups.indexOf(g) !== -1) return;
            renderedGroups.push(g);
            var items = groupItems[g];
            var collapsed = !isSearching && _paletteCollapsed[g];
            html += '<div class="gl-cmd-palette-group' + (collapsed ? ' collapsed' : '') + '" data-group="' + escHtml(g) + '">' +
              '<svg viewBox="0 0 16 16" class="gl-cmd-palette-group-chevron"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M4 6l4 4 4-4"/></svg>' +
              escHtml(g) +
              '<span class="gl-cmd-palette-group-count">' + items.length + '</span>' +
            '</div>';
            if (!collapsed) {
              items.forEach(function(entry) {
                html +=
                  '<div class="gl-cmd-palette-item' + (entry.idx === selectedIdx ? ' selected' : '') + '" data-idx="' + entry.idx + '">' +
                    getIconSvg(entry.cmd.icon) +
                    '<span class="gl-cmd-palette-item-label">' + escHtml(entry.cmd.label) + '</span>' +
                    (entry.cmd.hint ? '<span class="gl-cmd-palette-item-hint">' + escHtml(entry.cmd.hint) + '</span>' : '') +
                  '</div>';
              });
            }
          });
          if (!filtered.length) {
            html = '<div class="gl-cmd-palette-empty">' + escHtml(msg('cmdEmpty')) + '</div>';
          }
          listEl.innerHTML = html;
        }

        function getVisibleIndices() {
          var indices = [];
          var els = listEl.querySelectorAll('.gl-cmd-palette-item');
          els.forEach(function(el) { indices.push(parseInt(el.dataset.idx)); });
          return indices;
        }

        function scrollToSelected() {
          var sel = listEl.querySelector('.gl-cmd-palette-item.selected');
          if (sel) sel.scrollIntoView({ block: 'nearest' });
        }

        function execSelected() {
          if (filtered[selectedIdx]) {
            closePalette();
            filtered[selectedIdx].action();
          }
        }

        function closePalette() {
          _paletteOpen = false;
          overlay.remove();
          document.removeEventListener('keydown', onKey);
        }

        function onKey(e) {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closePalette();
            return;
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            var vis = getVisibleIndices();
            if (!vis.length) return;
            var curPos = vis.indexOf(selectedIdx);
            if (e.key === 'ArrowDown') {
              selectedIdx = curPos < vis.length - 1 ? vis[curPos + 1] : vis[vis.length - 1];
            } else {
              selectedIdx = curPos > 0 ? vis[curPos - 1] : vis[0];
            }
            renderList();
            scrollToSelected();
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            execSelected();
            return;
          }
        }

        listEl.addEventListener('click', function(e) {
          var groupEl = e.target.closest('.gl-cmd-palette-group');
          if (groupEl && !isSearching) {
            var groupName = groupEl.dataset.group;
            _paletteCollapsed[groupName] = !_paletteCollapsed[groupName];
            try { sessionStorage.setItem('gl-cmd-palette-collapsed', JSON.stringify(_paletteCollapsed)); } catch(e) {}
            renderList();
            var vis = getVisibleIndices();
            if (vis.length && vis.indexOf(selectedIdx) === -1) {
              selectedIdx = vis[0];
              renderList();
            }
            return;
          }
          var item = e.target.closest('.gl-cmd-palette-item');
          if (item) {
            selectedIdx = parseInt(item.dataset.idx);
            execSelected();
          }
        });

        var _fileSearchTimer = null;
        var _lastFileQuery = '';

        input.addEventListener('input', function() {
          var q = input.value.toLowerCase().trim();
          isSearching = !!q;
          if (!q) {
            filtered = cmds.slice();
            _lastFileQuery = '';
            renderList();
            var vis = getVisibleIndices();
            selectedIdx = vis.length ? vis[0] : 0;
            renderList();
            return;
          }

          // Filter commands
          var cmdResults = cmds.filter(function(cmd) {
            return cmd.label.toLowerCase().indexOf(q) !== -1 ||
                   (cmd.hint && cmd.hint.toLowerCase().indexOf(q) !== -1) ||
                   (cmd.group && cmd.group.toLowerCase().indexOf(q) !== -1);
          });
          filtered = cmdResults;
          renderList();
          var vis = getVisibleIndices();
          selectedIdx = vis.length ? vis[0] : 0;
          renderList();

          // File search with debounce (min 2 chars)
          if (q.length >= 2 && projectPath) {
            clearTimeout(_fileSearchTimer);
            _fileSearchTimer = setTimeout(function() {
              if (!_paletteOpen) return;
              _lastFileQuery = q;
              searchFiles(projectPath, q, function(files) {
                if (!_paletteOpen || input.value.toLowerCase().trim() !== _lastFileQuery) return;
                if (!files.length) return;

                var fileGroup = msg('cmdGroupFiles');
                var defaultBranch = _defaultBranch || 'main';
                var fileCmds = files.map(function(filePath) {
                  var fileName = filePath.split('/').pop();
                  return {
                    id: 'file-' + filePath,
                    label: fileName,
                    hint: filePath,
                    group: fileGroup,
                    icon: 'file',
                    action: function() {
                      window.location.href = '/' + projectPath + '/-/blob/' + encodeURIComponent(defaultBranch) + '/' + filePath;
                    }
                  };
                });

                // Re-filter commands with current query (may have changed)
                var currentQ = input.value.toLowerCase().trim();
                var currentCmdResults = cmds.filter(function(cmd) {
                  return cmd.label.toLowerCase().indexOf(currentQ) !== -1 ||
                         (cmd.hint && cmd.hint.toLowerCase().indexOf(currentQ) !== -1) ||
                         (cmd.group && cmd.group.toLowerCase().indexOf(currentQ) !== -1);
                });

                filtered = currentCmdResults.concat(fileCmds);
                selectedIdx = 0;
                renderList();
              });
            }, 300);
          }
        });

        listEl.addEventListener('mousemove', function(e) {
          var item = e.target.closest('.gl-cmd-palette-item');
          if (item) {
            var idx = parseInt(item.dataset.idx);
            if (idx !== selectedIdx) {
              selectedIdx = idx;
              renderList();
            }
          }
        });

        overlay.addEventListener('click', function(e) {
          if (e.target === overlay) closePalette();
        });

        document.addEventListener('keydown', onKey, true);

        document.body.appendChild(overlay);
        input.focus();
        renderList();
      }

      document.addEventListener('keydown', function(e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          e.stopPropagation();
          if (_paletteOpen) return;
          openPalette();
        }
      }, true);

      // ── Standup Modal ──────────────────────────────────────────────
      function openStandupModal() {
        var existing = document.querySelector('.gl-standup-overlay');
        if (existing) { existing.remove(); return; }

        var overlay = document.createElement('div');
        overlay.className = 'gl-standup-overlay';

        var modal = document.createElement('div');
        modal.className = 'gl-standup-modal';

        var now = new Date();
        function pad2(n) { return n < 10 ? '0' + n : '' + n; }
        var todayIso = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());

        modal.innerHTML =
          '<div class="gl-standup-header">' +
            '<span>' + escHtml(msg('standupTitle')) + '</span>' +
            '<div class="gl-standup-date-nav">' +
              '<button class="gl-standup-date-btn gl-standup-prev" title="Previous day">\u2039</button>' +
              '<input type="date" class="gl-standup-date" value="' + todayIso + '" max="' + todayIso + '">' +
              '<button class="gl-standup-date-btn gl-standup-next" title="Next day" disabled>\u203a</button>' +
            '</div>' +
            '<button class="gl-standup-close" title="Close">&times;</button>' +
          '</div>' +
          '<div class="gl-standup-body">' +
            '<div class="gl-standup-loading"><div class="gl-standup-spinner"></div></div>' +
          '</div>' +
          '<div class="gl-standup-actions" style="display:none">' +
            '<button class="gl-standup-copy">' + escHtml(msg('standupCopy')) + '</button>' +
          '</div>';

        overlay.appendChild(modal);

        var dateInput = modal.querySelector('.gl-standup-date');
        var prevBtn = modal.querySelector('.gl-standup-prev');
        var nextBtn = modal.querySelector('.gl-standup-next');
        var bodyEl = modal.querySelector('.gl-standup-body');
        var actionsEl = modal.querySelector('.gl-standup-actions');
        var copyBtn = modal.querySelector('.gl-standup-copy');
        var currentText = '';

        function updateNavButtons() {
          nextBtn.disabled = dateInput.value >= todayIso;
        }

        function loadDate(dateStr) {
          bodyEl.innerHTML = '<div class="gl-standup-loading"><div class="gl-standup-spinner"></div></div>';
          actionsEl.style.display = 'none';
          chrome.runtime.sendMessage({ type: 'generate-standup', gitlabUrl: GITLAB_URL, date: dateStr }, function(resp) {
            if (!resp || resp._error) {
              bodyEl.innerHTML = '<div class="gl-standup-error">' + escHtml(resp ? resp._error : 'No response') + '</div>';
              return;
            }
            currentText = resp.text || '';
            bodyEl.innerHTML = '<pre class="gl-standup-content">' + escHtml(currentText) + '</pre>';
            actionsEl.style.display = '';
          });
        }

        function shiftDate(days) {
          var d = new Date(dateInput.value + 'T00:00:00');
          d.setDate(d.getDate() + days);
          var iso = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
          if (iso > todayIso) return;
          dateInput.value = iso;
          updateNavButtons();
          loadDate(iso);
        }

        dateInput.addEventListener('change', function() {
          updateNavButtons();
          loadDate(dateInput.value);
        });
        prevBtn.addEventListener('click', function() { shiftDate(-1); });
        nextBtn.addEventListener('click', function() { shiftDate(1); });

        copyBtn.addEventListener('click', function() {
          navigator.clipboard.writeText(currentText).then(function() {
            var orig = copyBtn.textContent;
            copyBtn.textContent = '\u2713 ' + msg('standupCopied');
            setTimeout(function() { copyBtn.textContent = orig; }, 2000);
          });
        });

        function closeStandup() { overlay.remove(); }
        modal.querySelector('.gl-standup-close').addEventListener('click', closeStandup);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) closeStandup(); });
        document.addEventListener('keydown', function onEsc(e) {
          if (e.key === 'Escape' && document.querySelector('.gl-standup-overlay')) {
            closeStandup();
            document.removeEventListener('keydown', onEsc);
          }
        });

        document.body.appendChild(overlay);
        loadDate(todayIso);
      }
    });
  } catch(e) {}

})();
