(function() {
  'use strict';

  window.__glMrActionsLoaded = true;

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // i18n helper with manual language override
  var _i18nMessages = null;

  function t(key, substitutions) {
    if (_i18nMessages && _i18nMessages[key]) {
      var msg = _i18nMessages[key].message || '';
      if (substitutions && substitutions.length) {
        for (var i = 0; i < substitutions.length; i++) {
          msg = msg.replace('$' + (i + 1), substitutions[i]);
        }
      }
      return msg;
    }
    try {
      if (chrome && chrome.i18n) {
        var msg = chrome.i18n.getMessage(key, substitutions);
        if (msg) return msg;
      }
    } catch(e) {}
    return key;
  }

  var _languageReady = new Promise(function(resolve) {
    try {
      chrome.storage.sync.get({ language: 'auto' }, function(data) {
        if (chrome.runtime.lastError) { resolve(); return; }
        if (!data.language || data.language === 'auto') { resolve(); return; }
        fetch(chrome.runtime.getURL('_locales/' + data.language + '/messages.json'))
          .then(function(r) { return r.json(); })
          .then(function(msgs) { _i18nMessages = msgs; resolve(); })
          .catch(function() { resolve(); });
      });
    } catch(e) { resolve(); }
  });

  var GITLAB_URL = window.location.origin;
  var PROJECT_ID = null;
  var MR_IID = null;
  var PROJECT_PATH = null;

  // Parse current page URL: /<namespace>/<project>/-/merge_requests/<iid>
  function parsePage() {
    var match = window.location.pathname.match(/\/(.+?)\/-\/merge_requests\/(\d+)/);
    if (!match) return false;
    PROJECT_PATH = match[1];
    MR_IID = parseInt(match[2]);
    return true;
  }

  function getProjectId() {
    var el = document.querySelector('[data-project-id]');
    if (el) return parseInt(el.dataset.projectId);
    var body = document.querySelector('body');
    if (body && body.dataset.projectId) return parseInt(body.dataset.projectId);
    var scripts = document.querySelectorAll('script');
    for (var i = 0; i < scripts.length; i++) {
      var m = scripts[i].textContent.match(/"project_id"\s*:\s*(\d+)/);
      if (m) return parseInt(m[1]);
    }
    return null;
  }

  function getCsrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  // GitLab API helper — uses session cookies + CSRF token, no personal token needed
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

  function getMR() {
    return api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID);
  }

  var _mergeMethod = null;
  function getMergeMethod() {
    if (_mergeMethod) return Promise.resolve(_mergeMethod);
    return api('GET', '/projects/' + PROJECT_ID).then(function(project) {
      _mergeMethod = project.merge_method || 'merge';
      return _mergeMethod;
    });
  }

  function needsRebase() {
    return getMergeMethod().then(function(method) {
      return method === 'rebase_merge' || method === 'ff';
    });
  }

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  // =========================================================================
  // Actions
  // =========================================================================

  function doRebase(skipCI) {
    return api('PUT', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/rebase',
      skipCI ? { skip_ci: true } : {}
    ).then(function() {
      return pollRebase(0);
    }).catch(function(err) {
      var msg = (err.message || '').toLowerCase();
      // 403/405 = rebase not supported for this project merge method — skip silently
      if (msg.indexOf('403') !== -1 || msg.indexOf('forbidden') !== -1 ||
          msg.indexOf('405') !== -1) {
        return getMR();
      }
      // Re-throw real errors (conflict, closed MR, API changes) so user sees them
      throw err;
    });
  }

  function pollRebase(attempt) {
    attempt = (attempt || 0) + 1;
    if (attempt > 60) throw new Error('Timeout waiting for rebase to complete');
    return sleep(2000).then(function() {
      return getMR();
    }).then(function(mr) {
      if (mr.rebase_in_progress) return pollRebase(attempt);
      if (mr.merge_error) throw new Error('Rebase failed: ' + mr.merge_error);
      return mr;
    });
  }

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
      // patch (default)
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
    // Simple TOML parser — handles [section] and key = "value" patterns
    var result = {};
    var currentSection = result;
    var sectionPath = [];
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line[0] === '#') continue;
      var sectionMatch = line.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        sectionPath = sectionMatch[1].split('.');
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
    // Update version in TOML text preserving formatting
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

  function doVersionBump() {
    return getSettings().then(function(settings) {
      var filePath = settings.versionFile || 'package.json';
      var versionPath = settings.versionPath || 'version';
      var strategy = settings.versionStrategy || 'patch';
      var commitTemplate = settings.versionCommitTemplate || 'fix: bump version to {version}';

      return getMR().then(function(mr) {
        var branch = mr.source_branch;
        var readRef = settings.version_from_target ? mr.target_branch : branch;
        return api('GET', '/projects/' + PROJECT_ID + '/repository/files/' + encodeURIComponent(filePath) + '?ref=' + encodeURIComponent(readRef))
          .then(function(file) {
            var rawContent = decodeURIComponent(escape(atob(file.content)));
            var newVersion;
            var newRawContent;

            if (filePath.match(/\.json$/i)) {
              // JSON file (package.json, composer.json, etc.)
              var jsonObj = JSON.parse(rawContent);
              var currentVersion = getNestedValue(jsonObj, versionPath);
              if (!currentVersion) throw new Error('Version field "' + versionPath + '" not found in ' + filePath);
              newVersion = bumpVersion(currentVersion, strategy);
              setNestedValue(jsonObj, versionPath, newVersion);
              newRawContent = JSON.stringify(jsonObj, null, 2) + '\n';
            } else if (filePath.match(/\.toml$/i)) {
              // TOML file (pyproject.toml, Cargo.toml, etc.)
              var tomlObj = parseToml(rawContent);
              var currentVersion = getNestedValue(tomlObj, versionPath);
              if (!currentVersion) throw new Error('Version field "' + versionPath + '" not found in ' + filePath);
              newVersion = bumpVersion(currentVersion, strategy);
              newRawContent = updateTomlVersion(rawContent, versionPath, newVersion);
            } else {
              // Plain text file (version.txt, VERSION, etc.)
              var currentVersion = rawContent.trim();
              if (!currentVersion.match(/^\d+(\.\d+)*$/)) throw new Error('Invalid version format in ' + filePath + ': "' + currentVersion + '"');
              newVersion = bumpVersion(currentVersion, strategy);
              newRawContent = newVersion + '\n';
            }

            var newContent = btoa(unescape(encodeURIComponent(newRawContent)));
            var commitMessage = commitTemplate.replace(/\{version\}/g, newVersion);

            return api('PUT', '/projects/' + PROJECT_ID + '/repository/files/' + encodeURIComponent(filePath), {
              branch: branch,
              content: newContent,
              encoding: 'base64',
              commit_message: commitMessage,
            }).then(function() {
              return { version: newVersion, branch: branch };
            });
          });
      });
    });
  }

  function doReviewers(jobName, fixedReviewers) {
    jobName = jobName || 'get-reviewers';
    fixedReviewers = fixedReviewers || [];

    // If fixed reviewers configured — post comment mentioning them
    if (fixedReviewers.length) {
      showToast(t('toastAssigningReviewers'), 'success');
      var body = 'Reviewers: ' + fixedReviewers.map(function(u) { return '@' + u; }).join(' ');
      return api('POST', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/notes', { body: body })
        .then(function() {
          return { action: 'commented', usernames: fixedReviewers };
        });
    }

    return api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/notes?per_page=100')
      .then(function(notes) {
        var reviewerNote = null;
        for (var i = notes.length - 1; i >= 0; i--) {
          if (/Reviewers?\s*:/i.test(notes[i].body)) {
            reviewerNote = notes[i].body;
            break;
          }
        }

        if (reviewerNote) {
          showToast(t('toastRepostingReviewers'), 'success');
          return api('POST', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/notes', {
            body: reviewerNote,
          }).then(function() {
            return { action: 'reposted', comment: reviewerNote };
          });
        }

        showToast(t('toastNoReviewersTriggering', [jobName]), 'success');
        return api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/pipelines')
          .then(function(pipelines) {
            if (!pipelines.length) throw new Error('No pipelines found');
            return api('GET', '/projects/' + PROJECT_ID + '/pipelines/' + pipelines[0].id + '/jobs?per_page=100');
          })
          .then(function(jobs) {
            var job = null;
            for (var i = 0; i < jobs.length; i++) {
              if (jobs[i].name === jobName) { job = jobs[i]; break; }
            }
            if (!job) throw new Error('Job "' + jobName + '" not found in pipeline');

            if (job.status === 'manual' || job.status === 'skipped') {
              return api('POST', '/projects/' + PROJECT_ID + '/jobs/' + job.id + '/play')
                .then(function() { return { action: 'triggered', jobId: job.id }; });
            } else if (job.status === 'failed' || job.status === 'canceled') {
              return api('POST', '/projects/' + PROJECT_ID + '/jobs/' + job.id + '/retry')
                .then(function() { return { action: 'retried', jobId: job.id }; });
            } else {
              return { action: 'already ' + job.status, jobId: job.id };
            }
          });
      });
  }

  function doJustRebase() {
    showToast(t('toastRebasing'), 'success');
    return doRebase(false);
  }

  function doRebaseVersion() {
    var _rebase = false;
    return needsRebase().then(function(r) {
      _rebase = r;
      if (_rebase) {
        showToast(t('toastStep12Rebasing'), 'success');
        return doRebase(false);
      }
    }).then(function() {
      showToast(t('toastVersionBump'), 'success');
      return doVersionBump();
    });
  }

  function doRebaseAutoMerge() {
    var _rebase = false;
    return needsRebase().then(function(r) {
      _rebase = r;
      if (_rebase) {
        showToast(t('toastStep12Rebasing'), 'success');
        return doRebase(false);
      }
    }).then(function() {
      showToast(_rebase ? t('toastStep22Automerge') : t('toastEnablingAutomerge'), 'success');
      return doAutoMergeWithRetry(40, 3000);
    });
  }

  function doRebaseForce() {
    var _rebase = false;
    return needsRebase().then(function(r) {
      _rebase = r;
      if (_rebase) {
        showToast(t('toastStep12RebasingSki'), 'success');
        return doRebase(true);
      }
    }).then(function() {
      showToast(_rebase ? t('toastStep22Cancelling') : t('toastCancellingMerging'), 'success');
      return Promise.all([
        getMergeOptions(),
        api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/pipelines'),
      ]);
    }).then(function(results) {
      var mergeOpts = results[0];
      var pipelines = results[1];
      var cancelPromises = pipelines
        .filter(function(p) { return ['running', 'pending', 'created'].indexOf(p.status) !== -1; })
        .map(function(p) { return api('POST', '/projects/' + PROJECT_ID + '/pipelines/' + p.id + '/cancel').catch(function(){}); });
      return Promise.all(cancelPromises).then(function() { return mergeOpts; });
    }).then(function(mergeOpts) {
      return sleep(2000).then(function() {
        return api('PUT', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/merge', {
          squash: mergeOpts.squash,
          should_remove_source_branch: mergeOpts.should_remove_source_branch,
        });
      });
    });
  }

  function doPipelineRestart() {
    return getMR().then(function(mr) {
      showToast(t('toastCreatingPipeline', [mr.source_branch]), 'success');
      return api('POST', '/projects/' + PROJECT_ID + '/pipeline', {
        ref: mr.source_branch,
      });
    });
  }

  function doPipelineCancel() {
    return api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/pipelines')
      .then(function(pipelines) {
        var running = pipelines.filter(function(p) {
          return ['running', 'pending', 'created'].indexOf(p.status) !== -1;
        });
        if (!running.length) throw new Error(t('toastNoRunningPipelines'));
        showToast(t('toastCancellingPipelines', [String(running.length)]), 'success');
        return Promise.all(running.map(function(p) {
          return api('POST', '/projects/' + PROJECT_ID + '/pipelines/' + p.id + '/cancel').catch(function() {});
        }));
      });
  }

  function doDraftToggle() {
    return getMR().then(function(mr) {
      var isDraft = mr.title.match(/^(\[Draft\]|Draft:|WIP:)\s*/i);
      var newTitle;
      if (isDraft) {
        newTitle = mr.title.replace(/^(\[Draft\]|Draft:|WIP:)\s*/i, '');
        showToast(t('toastMarkingReady'), 'success');
      } else {
        newTitle = 'Draft: ' + mr.title;
        showToast(t('toastMarkingDraft'), 'success');
      }
      return api('PUT', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID, {
        title: newTitle,
      }).then(function() {
        return { wasDraft: !!isDraft, newTitle: newTitle };
      });
    });
  }

  function doRetryFailed() {
    return api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/pipelines')
      .then(function(pipelines) {
        if (!pipelines.length) throw new Error(t('toastNoPipelines'));
        return api('GET', '/projects/' + PROJECT_ID + '/pipelines/' + pipelines[0].id + '/jobs?per_page=100');
      })
      .then(function(jobs) {
        var failed = jobs.filter(function(j) { return j.status === 'failed'; });
        if (!failed.length) throw new Error(t('toastNoFailedJobs'));
        showToast(t('toastRetrying', [String(failed.length)]), 'success');
        return Promise.all(failed.map(function(job) {
          return api('POST', '/projects/' + PROJECT_ID + '/jobs/' + job.id + '/retry').catch(function() {});
        }));
      });
  }

  function findLatestJobByName(jobs, jobName) {
    // When a job is retried, GitLab creates a new job with the same name.
    // Pick the one with the highest ID (most recent).
    var found = null;
    for (var i = 0; i < jobs.length; i++) {
      if (jobs[i].name === jobName) {
        if (!found || jobs[i].id > found.id) found = jobs[i];
      }
    }
    return found;
  }

  function startJob(jobs, jobName) {
    var job = findLatestJobByName(jobs, jobName);
    if (!job) throw new Error('Job "' + jobName + '" not found in pipeline');

    if (job.status === 'success') {
      showToast(t('toastJobAlreadySucceeded', [jobName]), 'success');
      return Promise.resolve(job.id);
    } else if (job.status === 'manual' || job.status === 'skipped') {
      showToast(t('toastPlayingJob', [jobName]), 'success');
      return api('POST', '/projects/' + PROJECT_ID + '/jobs/' + job.id + '/play').then(function(resp) {
        return resp.id || job.id;
      });
    } else if (job.status === 'failed' || job.status === 'canceled') {
      showToast(t('toastRetryingJob', [jobName]), 'success');
      return api('POST', '/projects/' + PROJECT_ID + '/jobs/' + job.id + '/retry')
        .then(function(resp) { return resp.id || job.id; })
        .catch(function(err) {
          // 403 = job already retried, refetch and find the new one
          if (err.message && err.message.indexOf('403') !== -1) {
            return api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/pipelines')
              .then(function(p) { return api('GET', '/projects/' + PROJECT_ID + '/pipelines/' + p[0].id + '/jobs?per_page=100'); })
              .then(function(freshJobs) {
                var fresh = findLatestJobByName(freshJobs, jobName);
                if (!fresh) throw new Error('Job "' + jobName + '" not found after refetch');
                if (fresh.id !== job.id) return startJob(freshJobs, jobName);
                throw err;
              });
          }
          throw err;
        });
    } else if (job.status === 'running' || job.status === 'pending' || job.status === 'created') {
      showToast(t('toastJobAlreadyStatus', [jobName, job.status]), 'success');
      return Promise.resolve(job.id);
    } else {
      throw new Error('Job "' + jobName + '" is in unexpected status: ' + job.status);
    }
  }

  function waitForJob(jobId, jobName, maxAttempts) {
    maxAttempts = maxAttempts || 120;
    var attempt = 0;
    function findJobByName(name) {
      // Find the latest job with this name in the pipeline (retry creates new jobs)
      return api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/pipelines')
        .then(function(pipelines) {
          if (!pipelines.length) return null;
          return api('GET', '/projects/' + PROJECT_ID + '/pipelines/' + pipelines[0].id + '/jobs?per_page=100');
        })
        .then(function(jobs) {
          if (!jobs) return null;
          for (var i = 0; i < jobs.length; i++) {
            if (jobs[i].name === name) return jobs[i];
          }
          return null;
        });
    }
    function check() {
      attempt++;
      if (attempt > maxAttempts) throw new Error('Timeout waiting for job "' + jobName + '"');
      return sleep(20000).then(function() {
        // Look up by name in pipeline (handles retry creating new job IDs)
        return findJobByName(jobName);
      }).then(function(job) {
        if (!job) return api('GET', '/projects/' + PROJECT_ID + '/jobs/' + jobId);
        return job;
      }).then(function(job) {
        showToast(t('toastWaitingForJob', [jobName, job.status]), 'success');
        if (job.status === 'success') return job;
        if (job.status === 'failed') throw new Error('Job "' + jobName + '" failed');
        if (job.status === 'canceled') throw new Error('Job "' + jobName + '" was canceled');
        return check();
      });
    }
    return check();
  }

  function doTriggerJob(jobNameStr) {
    // Support comma-separated job names for chaining: "job1, job2, job3"
    var jobNames = jobNameStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean);

    // Single job — run directly in content script
    if (jobNames.length === 1) {
      return api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/pipelines')
        .then(function(pipelines) {
          if (!pipelines.length) throw new Error('No pipelines found');
          return api('GET', '/projects/' + PROJECT_ID + '/pipelines/' + pipelines[0].id + '/jobs?per_page=100');
        })
        .then(function(jobs) {
          return startJob(jobs, jobNames[0]);
        });
    }

    // Multi-job chain — delegate to background service worker (survives page navigation)
    return getMR().then(function(mr) {
      var mrTitle = '!' + MR_IID + ' ' + (mr.title || '');
      return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage({
        type: 'start-job-chain',
        jobs: jobNames,
        gitlabUrl: GITLAB_URL,
        projectId: PROJECT_ID,
        mrIid: MR_IID,
        mrTitle: mrTitle,
      }, function(response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.taskId) {
          pollTaskStatus(response.taskId, jobNames, mrTitle);
          resolve({ taskId: response.taskId });
        } else {
          reject(new Error('Failed to start background job chain'));
        }
      });
    });
    });
  }

  // =========================================================================
  // Background tasks tracker panel
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
    getTrackerFab();
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

  function restoreActiveTasks() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
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

  function getMergeOptions() {
    return getMR().then(function(mr) {
      return {
        squash: !!mr.squash,
        should_remove_source_branch: !!(mr.force_remove_source_branch || mr.should_remove_source_branch),
      };
    });
  }

  function doAutoMerge() {
    return getMR().then(function(mr) {
      if (mr.has_conflicts) throw new Error('MR has conflicts');
      if (mr.blocking_discussions_resolved === false) throw new Error('Unresolved threads');
      return api('PUT', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/merge', {
        merge_when_pipeline_succeeds: true,
        squash: !!mr.squash,
        should_remove_source_branch: !!(mr.force_remove_source_branch || mr.should_remove_source_branch),
      });
    });
  }

  function waitForBranchInMR(branch, maxAttempts) {
    maxAttempts = maxAttempts || 40;
    // Step 1: get actual branch HEAD from repository API
    return api('GET', '/projects/' + PROJECT_ID + '/repository/branches/' + encodeURIComponent(branch))
      .then(function(branchData) {
        var expectedSha = branchData.commit.id;
        // Step 2: poll MR until sha matches
        // GitLab 18.x: check both sha and diff_head_sha — either may update first
        var attempt = 0;
        function check() {
          attempt++;
          if (attempt > maxAttempts) {
            // GitLab 18.x bug: sha fields may lag — verify via MR commits API as fallback
            return api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/commits')
              .then(function(commits) {
                if (commits && commits.length && commits[0].id === expectedSha) return getMR();
                throw new Error('Timeout waiting for MR to sync with branch HEAD');
              });
          }
          return sleep(3000).then(function() {
            return getMR();
          }).then(function(mr) {
            showToast(t('toastWaitingMrSync', [String(attempt), String(maxAttempts)]), 'success');
            if (mr.sha === expectedSha || mr.diff_head_sha === expectedSha) return mr;
            return check();
          });
        }
        return check();
      });
  }

  function waitForNewPipeline(oldSha, maxAttempts) {
    maxAttempts = maxAttempts || 15;
    var activePipelineStatuses = ['running', 'pending', 'created', 'waiting_for_resource', 'preparing', 'scheduled'];
    var attempt = 0;
    function check() {
      attempt++;
      if (attempt > maxAttempts) throw new Error('Timeout waiting for new pipeline');
      return sleep(3000).then(function() {
        return getMR();
      }).then(function(mr) {
        // GitLab 18.x: check both sha fields
        var currentSha = mr.sha || mr.diff_head_sha;
        if (currentSha === oldSha) return check();
        // SHA changed, now check pipeline
        return api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/pipelines')
          .then(function(pipelines) {
            if (pipelines.length > 0 && activePipelineStatuses.indexOf(pipelines[0].status) !== -1) {
              return mr;
            }
            return check();
          });
      });
    }
    return check();
  }

  function doAutoMergeWithRetry(maxRetries, interval) {
    maxRetries = maxRetries || 40;
    interval = interval || 3000;
    var attempt = 0;
    var _mergeOpts = null;
    // Errors that mean "stop retrying, it won't help"
    var fatalPatterns = ['has_conflicts', 'conflict', 'you don\'t have permissions', '405', 'method not allowed'];
    function isFatal(msg) {
      var lower = msg.toLowerCase();
      return fatalPatterns.some(function(p) { return lower.indexOf(p) !== -1; });
    }
    function tryMerge() {
      attempt++;
      showToast(t('toastAutomergeAttempt', [String(attempt), String(maxRetries)]), 'success');
      return api('PUT', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/merge', {
        merge_when_pipeline_succeeds: true,
        squash: _mergeOpts.squash,
        should_remove_source_branch: _mergeOpts.should_remove_source_branch,
      }).catch(function(err) {
        if (attempt < maxRetries && !isFatal(err.message)) {
          return sleep(interval).then(tryMerge);
        }
        throw err;
      });
    }
    return getMergeOptions().then(function(opts) {
      _mergeOpts = opts;
      return tryMerge();
    });
  }

  function waitMRReady(maxAttempts) {
    // Wait until GitLab processes the new commit: pipeline started
    maxAttempts = maxAttempts || 40;
    var activePipelineStatuses = ['running', 'pending', 'created', 'waiting_for_resource', 'preparing', 'scheduled'];
    var attempt = 0;
    function check() {
      attempt++;
      if (attempt > maxAttempts) throw new Error('Timeout: GitLab did not create pipeline after ' + (maxAttempts * 3) + 's');
      return sleep(3000).then(function() {
        return getMR();
      }).then(function(mr) {
        showToast(t('toastWaitingPipeline') + ' (' + attempt + '/' + maxAttempts + ')', 'success');
        var hp = mr.head_pipeline;
        if (hp && hp.status && activePipelineStatuses.indexOf(hp.status) !== -1) return mr;
        // GitLab 18.x: head_pipeline may lag — check pipelines API directly
        return api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/pipelines')
          .then(function(pipelines) {
            if (pipelines.length > 0 && activePipelineStatuses.indexOf(pipelines[0].status) !== -1) return mr;
            return check();
          });
      });
    }
    return check();
  }

  function doShip() {
    var _rebase = false;
    return needsRebase().then(function(r) {
      _rebase = r;
      if (_rebase) {
        showToast(t('toastRebasing'), 'success');
        return doRebase(false);
      }
    }).then(function() {
      showToast(t('toastVersionBump'), 'success');
      return doVersionBump();
    }).then(function(result) {
      showToast(t('toastWaitingSync', [result.version]), 'success');
      return waitForBranchInMR(result.branch);
    }).then(function() {
      showToast(t('toastWaitingPipeline'), 'success');
      return waitMRReady();
    }).then(function() {
      showToast(t('toastEnablingAutomerge'), 'success');
      return doAutoMergeWithRetry(40, 3000);
    });
  }

  function doForceShip() {
    var _rebase = false;
    return needsRebase().then(function(r) {
      _rebase = r;
      if (_rebase) {
        showToast(t('toastStep12RebasingSki'), 'success');
        return doRebase(true);
      }
    }).then(function() {
      showToast(t('toastVersionBump'), 'success');
      return doVersionBump();
    }).then(function(result) {
      showToast(t('toastWaitingSync', [result.version]), 'success');
      return waitForBranchInMR(result.branch);
    }).then(function() {
      showToast(t('toastWaiting15s'), 'success');
      return sleep(15000);
    }).then(function() {
      showToast(t('toastStep22Cancelling'), 'success');
      return Promise.all([
        getMergeOptions(),
        api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/pipelines'),
      ]);
    }).then(function(results) {
      var mergeOpts = results[0];
      var pipelines = results[1];
      var cancelPromises = pipelines
        .filter(function(p) { return ['running', 'pending', 'created'].indexOf(p.status) !== -1; })
        .map(function(p) { return api('POST', '/projects/' + PROJECT_ID + '/pipelines/' + p.id + '/cancel').catch(function(){}); });
      return Promise.all(cancelPromises).then(function() { return mergeOpts; });
    }).then(function(mergeOpts) {
      return sleep(2000).then(function() {
        return api('PUT', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/merge', {
          squash: mergeOpts.squash,
          should_remove_source_branch: mergeOpts.should_remove_source_branch,
        });
      });
    });
  }

  function doCopyMr() {
    return getMR().then(function(mr) {
      var text = mr.title + '\n' + mr.web_url;
      return navigator.clipboard.writeText(text).then(function() {
        showToast(t('toastCopied'), 'success', true);
      });
    });
  }

  // =========================================================================
  // UI
  // =========================================================================

  function showToast(message, type, quiet) {
    try {
      var existing = document.querySelectorAll('.gl-mr-actions-toast');
      existing.forEach(function(el) { el.remove(); });

      var toast = document.createElement('div');
      toast.className = 'gl-mr-actions-toast ' + type;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(function() { try { toast.remove(); } catch(e) {} }, 5000);

      // Sound & notification — skip if extension was reloaded or quiet mode
      if (!quiet && isExtensionValid()) {
        getSettings().then(function(s) {
          if (isExtensionValid() && s.sound_enabled) playSound(type === 'error' ? 'error' : 'success');
          if (isExtensionValid() && s.notifications_enabled !== false && message && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('GitLab MR Actions', { body: message, silent: false });
          }
        }).catch(function() {});
      }
    } catch(e) {}
  }

  function playSound(type) {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var now = ctx.currentTime;
      var notes = type === 'error'
        ? [[400, 0, 0.15], [280, 0.18, 0.15]]
        : [[523, 0, 0.12], [659, 0.1, 0.12], [784, 0.2, 0.18]];
      var vol = type === 'error' ? 0.18 : 0.15;
      notes.forEach(function(n) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = n[0];
        gain.gain.setValueAtTime(vol, now + n[1]);
        gain.gain.exponentialRampToValueAtTime(0.001, now + n[1] + n[2]);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + n[1]); osc.stop(now + n[1] + n[2]);
      });
      setTimeout(function() { try { ctx.close(); } catch(e) {} }, 1000);
    } catch(e) {}
  }

  var _actionInProgress = false;

  function runAction(btn, actionFn, actionName, opts) {
    if (_actionInProgress) return;
    _actionInProgress = true;
    opts = opts || {};
    var origHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;

    getSettings().then(function(s) {
      if (s.notifications_enabled !== false && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }).catch(function() {});

    var mrTitle = document.querySelector('.merge-request .detail-page-header .title')
      || document.querySelector('.detail-page-description .title')
      || document.querySelector('.merge-request-details .title');
    var titleText = mrTitle ? mrTitle.textContent.trim() : '';

    // Track single jobs in background tracker
    var singleTaskId = 'single-' + Date.now();
    updateTrackerItem(singleTaskId, [actionName], 'running: ' + actionName, null, '!' + MR_IID + ' ' + titleText);

    actionFn().then(function() {
      _actionInProgress = false;
      btn.innerHTML = '&#10003;';
      var msg = t('toastCompleted', [actionName]) + (titleText ? '\n' + titleText : '');
      showToast(msg, 'success');
      updateTrackerItem(singleTaskId, [actionName], 'done', null, '!' + MR_IID + ' ' + titleText);
      if (opts.reloadOnSuccess) {
        setTimeout(function() { window.location.reload(); }, 5000);
      }
    }).catch(function(err) {
      _actionInProgress = false;
      btn.innerHTML = origHtml;
      btn.disabled = false;
      var msg = t('toastFailed', [actionName, err.message]) + (titleText ? '\n' + titleText : '');
      showToast(msg, 'error');
      updateTrackerItem(singleTaskId, [actionName], 'error', err.message, '!' + MR_IID + ' ' + titleText);
    });
  }

  var SETTINGS_DEFAULTS = {
    btn_version: false,
    btn_rebase: false,
    btn_rebase_version: false,
    btn_rebase_automerge: false,
    btn_rebase_force: false,
    btn_ship: false,
    btn_force_ship: false,
    btn_reviewers: false,
    btn_pipeline_restart: false,
    btn_pipeline_cancel: false,
    btn_draft_toggle: false,
    btn_retry_failed: false,
    btn_copy_mr: false,
    sound_enabled: false,
    notifications_enabled: true,
    show_time_tracker: true,
    show_failed_job_view: true,
    skip_confirmations: false,
    dim_drafts: false,
    highlight_own_mrs: false,
    show_sensitive_warning: false,
    show_git_commands: false,
    reviewersList: '',
    reviewersJob: 'get-reviewers',
    quickComments: [],
    customJobs: [],
    buttonOrder: [],
    projectProfiles: {},
    versionFile: 'package.json',
    versionPath: 'version',
    versionStrategy: 'patch',
    versionCommitTemplate: 'fix: bump version to {version}',
    version_from_target: false,
  };

  function isExtensionValid() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; }
  }

  function getSettings() {
    if (!isExtensionValid()) return Promise.resolve(SETTINGS_DEFAULTS);
    return new Promise(function(resolve) {
      try {
        chrome.storage.sync.get(SETTINGS_DEFAULTS, function(data) {
          if (!isExtensionValid()) { resolve(SETTINGS_DEFAULTS); return; }
          // Merge project-specific profile over defaults
          var profile = findProjectProfile(data.projectProfiles, PROJECT_PATH);
          if (profile) {
            var merged = {};
            for (var k in data) merged[k] = data[k];
            if (profile.versionFile) merged.versionFile = profile.versionFile;
            if (profile.versionPath) merged.versionPath = profile.versionPath;
            if (profile.versionStrategy) merged.versionStrategy = profile.versionStrategy;
            if (profile.versionCommitTemplate) merged.versionCommitTemplate = profile.versionCommitTemplate;
            if (profile.reviewersList) merged.reviewersList = profile.reviewersList;
            if (profile.reviewersJob) merged.reviewersJob = profile.reviewersJob;
            if (profile.customJobs) merged.customJobs = profile.customJobs;
            if (profile.buttonOrder) merged.buttonOrder = profile.buttonOrder;
            if (profile.buttons) {
              for (var bk in profile.buttons) merged[bk] = profile.buttons[bk];
            }
            resolve(merged);
          } else {
            resolve(data);
          }
        });
      } catch(e) {
        resolve(SETTINGS_DEFAULTS);
      }
    });
  }

  function findProjectProfile(profiles, projectPath) {
    if (!profiles || !projectPath) return null;
    // Exact match first
    if (profiles[projectPath]) return profiles[projectPath];
    for (var pattern in profiles) {
      if (projectPath.indexOf(pattern) !== -1) return profiles[pattern];
    }
    return null;
  }

  var _injecting = false;
  function injectButtons() {
    if (_injecting || document.querySelector('.gl-mr-actions-ext')) return;

    var stateBadge = document.querySelector('.issuable-status-badge .badge');
    if (stateBadge) {
      var stateText = stateBadge.textContent.trim().toLowerCase();
      if (stateText === 'merged' || stateText === 'closed') return;
    }

    var widgetSection = document.querySelector('[data-testid="mr-widget-content"].mr-widget-section') ||
                        document.querySelector('[data-testid="mr-widget-content"]') ||
                        document.querySelector('.mr-widget-content') ||
                        document.querySelector('.mr-widget-section');
    if (!widgetSection) return;

    _injecting = true;

    Promise.all([getMR(), getSettings(), getMergeMethod(), _languageReady]).then(function(results) {
      var mr = results[0];
      var s = results[1];
      var mergeMethod = results[2];

      if (document.querySelector('.gl-mr-actions-ext')) return;
      if (mr.state !== 'opened') return;

      var container = document.createElement('div');
      container.className = 'gl-mr-actions-ext';

      var blocked = mr.has_conflicts || mr.blocking_discussions_resolved === false;
      var reviewersJob = s.reviewersJob || 'get-reviewers';
      var fixedReviewers = (s.reviewersList || '').split(/[,\s]+/).map(function(u) { return u.replace(/^@/, '').trim(); }).filter(Boolean);
      var isDraft = /^(\[Draft\]|Draft:|WIP:)/i.test(mr.title);
      var rb = mergeMethod === 'rebase_merge' || mergeMethod === 'ff'; // needs rebase

      var builtinDefs = {
        btn_version:          { label: t('btnVersion'),                                                        cls: 'btn-version',     action: doVersionBump,     name: t('btnVersion') },
        btn_rebase:           { label: t('btnRebase'),                                                         cls: 'btn-pipeline',    action: doJustRebase,      name: t('btnRebase'), confirm: t('confirmRebase'), hide: !rb },
        btn_rebase_version:   { label: t('btnRebaseVersion'),                                                  cls: 'btn-version',     action: doRebaseVersion,   name: t('btnRebaseVersion'), confirm: t('confirmRebaseVersion'), hide: !rb },
        btn_rebase_automerge: { label: rb ? t('btnRebaseAutomerge') : t('labelAutomerge'),                     cls: 'btn-ship',        action: doRebaseAutoMerge, name: rb ? t('btnRebaseAutomerge') : t('labelAutomerge'), confirm: rb ? t('confirmRebaseAutomerge') : t('confirmAutomerge'), hide: blocked, reloadOnSuccess: true },
        btn_rebase_force:     { label: rb ? t('btnRebaseForce') : t('labelForceMerge'),                        cls: 'btn-force-ship',  action: doRebaseForce,     name: rb ? t('btnRebaseForce') : t('labelForceMerge'), confirm: rb ? t('confirmRebaseForce') : t('confirmForce'), hide: blocked, reloadOnSuccess: true },
        btn_ship:             { label: rb ? t('btnShip') : t('labelVersionAutomerge'),                         cls: 'btn-ship',        action: doShip,            name: 'Ship', confirm: rb ? t('confirmShip') : t('confirmShipNoRebase'), hide: blocked, reloadOnSuccess: true },
        btn_force_ship:       { label: rb ? t('btnForceShip') : t('labelVersionForceMerge'),                   cls: 'btn-force-ship',  action: doForceShip,       name: 'Force Ship', confirm: rb ? t('confirmForceShip') : t('confirmForceShipNoRebase'), hide: blocked, reloadOnSuccess: true },
        btn_reviewers:        { label: t('btnReviewers'),                cls: 'btn-reviewers',   action: function() { return doReviewers(reviewersJob, fixedReviewers); }, name: t('btnReviewers') },
        btn_pipeline_restart: { label: t('labelNewPipeline'),            cls: 'btn-pipeline',    action: doPipelineRestart,  name: t('labelNewPipeline'), confirm: t('confirmNewPipeline') },
        btn_pipeline_cancel:  { label: t('btnPipelineCancel'),           cls: 'btn-force-ship',  action: doPipelineCancel,   name: t('btnPipelineCancel'), confirm: t('confirmCancelPipeline') },
        btn_draft_toggle:     { label: isDraft ? t('labelMarkReady') : t('labelMarkDraft'), cls: 'btn-draft', action: doDraftToggle, name: t('btnDraftToggle') },
        btn_retry_failed:     { label: t('labelRetryFailed'),            cls: 'btn-pipeline',    action: doRetryFailed, name: t('btnRetryFailed') },
        btn_copy_mr:          { label: t('btnCopyMr'),                   cls: 'btn-draft',       action: doCopyMr, name: t('btnCopyMr'), quiet: true },
      };

      // Build ordered list of all buttons (builtins + custom)
      var allKeys = Object.keys(builtinDefs);
      (s.customJobs || []).forEach(function(j, i) { allKeys.push('custom_' + i); });

      var orderedKeys = [];
      (s.buttonOrder || []).forEach(function(key) {
        if (allKeys.indexOf(key) !== -1) orderedKeys.push(key);
      });
      allKeys.forEach(function(key) {
        if (orderedKeys.indexOf(key) === -1) orderedKeys.push(key);
      });

      orderedKeys.forEach(function(key) {
        if (key.indexOf('custom_') === 0) {
          var idx = parseInt(key.replace('custom_', ''));
          var job = (s.customJobs || [])[idx];
          if (!job || !job.label || !job.jobName) return;
          var btn = document.createElement('button');
          btn.className = 'btn-custom-job';
          btn.textContent = job.label;
          btn.title = job.label;
          btn.addEventListener('click', function() {
            runAction(btn, function() { return doTriggerJob(job.jobName); }, job.label);
          });
          container.appendChild(btn);
        } else {
          var def = builtinDefs[key];
          if (!def || !s[key] || def.hide) return;
          var btn = document.createElement('button');
          btn.className = def.cls;
          btn.textContent = def.label;
          btn.title = def.label;
          btn.addEventListener('click', function() {
            if (def.confirm && !s.skip_confirmations && !confirm(def.confirm)) return;
            if (def.quiet) {
              var origText = btn.textContent;
              btn.disabled = true;
              def.action().then(function() {
                btn.textContent = '\u2713';
                setTimeout(function() { btn.textContent = origText; btn.disabled = false; }, 2000);
              }).catch(function() { btn.disabled = false; });
            } else {
              runAction(btn, def.action, def.name, { reloadOnSuccess: def.reloadOnSuccess });
            }
          });
          container.appendChild(btn);
        }
      });

      // Quick comments (#35)
      (s.quickComments || []).forEach(function(qc) {
        if (!qc.label || !qc.text) return;
        var qcBtn = document.createElement('button');
        qcBtn.className = 'btn-quick-comment';
        qcBtn.textContent = qc.label;
        qcBtn.title = qc.text;
        qcBtn.addEventListener('click', function() {
          var origText = qcBtn.textContent;
          qcBtn.disabled = true;
          qcBtn.innerHTML = '<span class="spinner"></span>';
          api('POST', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/notes', { body: qc.text })
            .then(function() {
              qcBtn.textContent = '\u2713';
              setTimeout(function() { qcBtn.textContent = origText; qcBtn.disabled = false; }, 2000);
            })
            .catch(function(err) {
              showToast(err.message, 'error');
              qcBtn.textContent = origText;
              qcBtn.disabled = false;
            });
        });
        container.appendChild(qcBtn);
      });

      // Expose available actions for command palette
      var paletteKeyMap = {
        btn_copy_mr: 'mr-copy',
        btn_rebase: 'mr-rebase',
        btn_version: 'mr-version',
        btn_rebase_automerge: 'mr-automerge',
        btn_ship: 'mr-ship',
        btn_draft_toggle: 'mr-draft',
        btn_pipeline_restart: 'mr-pipeline-restart',
        btn_pipeline_cancel: 'mr-pipeline-cancel',
        btn_retry_failed: 'mr-retry-failed',
        btn_reviewers: 'mr-reviewers',
        btn_rebase_version: 'mr-rebase-version',
        btn_rebase_force: 'mr-rebase-force',
        btn_force_ship: 'mr-force-ship'
      };
      var paletteActions = [];
      orderedKeys.forEach(function(key) {
        if (key.indexOf('custom_') === 0) {
          var idx = parseInt(key.replace('custom_', ''));
          var job = (s.customJobs || [])[idx];
          if (job && job.label && job.jobName) {
            paletteActions.push({ id: 'custom-job-' + idx, label: job.label, icon: 'action' });
          }
        } else {
          var def = builtinDefs[key];
          if (!def || !s[key] || def.hide) return;
          var palId = paletteKeyMap[key];
          if (palId) {
            paletteActions.push({ id: palId, label: def.label, icon: key.indexOf('pipeline') !== -1 ? 'pipe' : (key === 'btn_copy_mr' ? 'copy' : 'action') });
          }
        }
      });
      // Quick comments as palette actions
      (s.quickComments || []).forEach(function(qc, i) {
        if (qc.label && qc.text) {
          paletteActions.push({ id: 'quick-comment-' + i, label: qc.label, icon: 'action' });
        }
      });
      window.__glMrPaletteActions = paletteActions;

      // Conflicts indicator badge
      if (mr.has_conflicts) {
        var conflictBadge = document.createElement('span');
        conflictBadge.className = 'gl-mr-actions-conflict-badge';
        conflictBadge.textContent = t('conflictsBadge');
        conflictBadge.title = t('conflictsBadgeHint');
        container.insertBefore(conflictBadge, container.firstChild);
      }

      // Time tracker — show MR age
      if (s.show_time_tracker !== false) {
        var timeEl = document.createElement('span');
        timeEl.className = 'gl-mr-actions-time';
        timeEl.title = t('timeTrackerTitle', [new Date(mr.created_at).toLocaleString()]);
        timeEl.textContent = formatElapsed(mr.created_at);
        container.insertBefore(timeEl, container.firstChild);
      }

      if (container.children.length > 0) {
        widgetSection.appendChild(container);
      }

      // Failed job quick view
      injectFailedJobView(mr, s, widgetSection);

      // Sensitive file warning (#13)
      if (s.show_sensitive_warning) {
        injectSensitiveWarning(mr);
      }

      // Git command generator (#12) — injected into description block, not action bar
      if (s.show_git_commands) {
        // Delay slightly to let Vue render description
        setTimeout(function() { injectGitCommands(mr); }, 500);
      }
    }).catch(function() {}).finally(function() { _injecting = false; });
  }

  function formatElapsed(createdAt) {
    var diff = Date.now() - new Date(createdAt).getTime();
    var minutes = Math.floor(diff / 60000);
    var hours = Math.floor(minutes / 60);
    var days = Math.floor(hours / 24);

    if (days > 0) return days + 'd ' + (hours % 24) + 'h';
    if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
    return minutes + 'm';
  }

  // =========================================================================
  // Failed Job Quick View
  // =========================================================================

  var ANSI_COLORS = {
    '30': '#555', '31': '#e05d44', '32': '#3fb950', '33': '#d29922',
    '34': '#58a6ff', '35': '#bc8cff', '36': '#76e4f7', '37': '#e6e6e6',
    '90': '#888', '91': '#ff7b72', '92': '#7ee787', '93': '#e3b341',
    '94': '#79c0ff', '95': '#d2a8ff', '96': '#a5d6ff', '97': '#ffffff'
  };

  function ansiToHtml(text) {
    // Strip GitLab section markers
    text = text.replace(/section_(start|end):[^\r\n]*/g, '');
    var result = '';
    var open = false;
    var i = 0;
    while (i < text.length) {
      if (text.charCodeAt(i) === 0x1b && text.charAt(i + 1) === '[') {
        var end = text.indexOf('m', i + 2);
        if (end === -1) { i++; continue; }
        var codes = text.substring(i + 2, end).split(';');
        if (open) { result += '</span>'; open = false; }
        for (var c = 0; c < codes.length; c++) {
          var color = ANSI_COLORS[codes[c]];
          if (color) {
            result += '<span style="color:' + color + '">';
            open = true;
            break;
          }
          if (codes[c] === '0' || codes[c] === '') {
            break;
          }
          if (codes[c] === '1') {
            result += '<span style="font-weight:700">';
            open = true;
            break;
          }
        }
        i = end + 1;
      } else {
        var ch = text.charAt(i);
        if (ch === '<') result += '&lt;';
        else if (ch === '>') result += '&gt;';
        else if (ch === '&') result += '&amp;';
        else result += ch;
        i++;
      }
    }
    if (open) result += '</span>';
    return result;
  }

  function fetchJobTrace(jobId) {
    var url = GITLAB_URL + '/api/v4/projects/' + PROJECT_ID + '/jobs/' + jobId + '/trace';
    return fetch(url, { credentials: 'same-origin' }).then(function(r) {
      if (!r.ok) return escHtml(t('failedJobTraceError'));
      return r.text().then(function(text) {
        var lines = text.split('\n').filter(function(l) { return l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim() !== ''; });
        return ansiToHtml(lines.slice(-50).join('\n'));
      });
    }).catch(function() {
      return escHtml(t('failedJobTraceError'));
    });
  }

  var CHEVRON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M3 10l5-5 5 5"/></svg>';

  function injectFailedJobView(mr, s, widgetSection) {
    if (s.show_failed_job_view === false) return;
    if (document.querySelector('.gl-mr-actions-failed-jobs')) return;

    function renderForPipeline(pipelineId) {
      api('GET', '/projects/' + PROJECT_ID + '/pipelines/' + pipelineId + '/jobs?scope[]=failed&per_page=10')
        .then(function(jobs) {
          if (!jobs || !jobs.length) return;
          if (document.querySelector('.gl-mr-actions-failed-jobs')) return;

          var wrapper = document.createElement('div');
          wrapper.className = 'gl-mr-actions-failed-jobs';

          var header = document.createElement('div');
          header.className = 'gl-mr-actions-failed-jobs-header';
          header.innerHTML = '<span class="gl-mr-actions-failed-jobs-title">' +
            escHtml(t('failedJobsCount', [jobs.length])) +
            '</span>' +
            '<span class="gl-mr-actions-failed-jobs-toggle">' + CHEVRON_SVG + '</span>';
          wrapper.appendChild(header);

          var list = document.createElement('div');
          list.className = 'gl-mr-actions-failed-jobs-list';
          wrapper.appendChild(list);

          header.addEventListener('click', function() {
            var visible = list.style.display !== 'none';
            list.style.display = visible ? 'none' : '';
            wrapper.classList.toggle('collapsed', visible);
          });

          var displayJobs = jobs.slice(0, 5);
          var tracePromises = displayJobs.map(function(job) {
            return fetchJobTrace(job.id).then(function(trace) {
              return { job: job, trace: trace };
            });
          });

          Promise.all(tracePromises).then(function(results) {
            results.forEach(function(r, i) {
              var item = document.createElement('div');
              item.className = 'gl-mr-actions-failed-job-item';

              var jobUrl = GITLAB_URL + '/' + PROJECT_PATH + '/-/jobs/' + r.job.id;
              var nameRow = document.createElement('div');
              nameRow.className = 'gl-mr-actions-failed-job-name';
              nameRow.innerHTML = '<a href="' + escHtml(jobUrl) + '" target="_blank">' + escHtml(r.job.name) + '</a>' +
                (r.job.stage ? ' <span class="gl-mr-actions-failed-job-stage">' + escHtml(r.job.stage) + '</span>' : '') +
                '<span class="gl-mr-actions-failed-job-expand">' + CHEVRON_SVG + '</span>';
              item.appendChild(nameRow);

              var trace = document.createElement('pre');
              trace.className = 'gl-mr-actions-failed-job-trace';
              trace.innerHTML = r.trace;
              if (i !== 0) {
                trace.style.display = 'none';
                item.classList.add('collapsed');
              }
              item.appendChild(trace);

              nameRow.addEventListener('click', function(e) {
                if (e.target.closest('a')) return;
                var visible = trace.style.display !== 'none';
                trace.style.display = visible ? 'none' : '';
                item.classList.toggle('collapsed', visible);
                if (!visible) {
                  requestAnimationFrame(function() {
                    requestAnimationFrame(function() { trace.scrollTop = trace.scrollHeight; });
                  });
                }
              });

              list.appendChild(item);
            });

            if (jobs.length > 5) {
              var more = document.createElement('div');
              more.className = 'gl-mr-actions-failed-jobs-more';
              more.textContent = t('failedJobsMore', [jobs.length - 5]);
              list.appendChild(more);
            }

            widgetSection.appendChild(wrapper);
            requestAnimationFrame(function() {
              var traces = wrapper.querySelectorAll('.gl-mr-actions-failed-job-trace');
              for (var i = 0; i < traces.length; i++) {
                if (traces[i].style.display !== 'none') {
                  traces[i].scrollTop = traces[i].scrollHeight;
                }
              }
            });
          });
        })
        .catch(function() {});
    }

    if (mr.head_pipeline && mr.head_pipeline.status === 'failed') {
      renderForPipeline(mr.head_pipeline.id);
    } else {
      // GitLab 18.x: head_pipeline may lag or be absent — check pipelines API directly
      api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/pipelines?per_page=1')
        .then(function(pipelines) {
          if (pipelines && pipelines.length && pipelines[0].status === 'failed') {
            renderForPipeline(pipelines[0].id);
          }
        }).catch(function() {});
    }
  }

  // =========================================================================
  // Sensitive file warning (#13)
  // =========================================================================

  var SENSITIVE_PATTERNS = [
    /^\.env(\..*)?$/i,
    /^Dockerfile(\..*)?$/i,
    /^docker-compose[^/]*\.ya?ml$/i,
    /^\.gitlab-ci\.yml$/i,
    /^\.github\/workflows\//i,
    /^Jenkinsfile$/i,
    /credentials/i,
    /secrets?\.(json|ya?ml|toml|xml|properties|cfg|conf|ini)$/i,
    /^\.ssh\//i,
    /^\.npmrc$/i,
    /^\.pypirc$/i,
    /^\.htpasswd$/i,
    /^\.pgpass$/i,
    /^id_rsa/i,
    /\.pem$/i,
    /\.key$/i
  ];

  function isSensitiveFile(filepath) {
    var name = filepath.replace(/^.*\//, '');
    for (var i = 0; i < SENSITIVE_PATTERNS.length; i++) {
      if (SENSITIVE_PATTERNS[i].test(name) || SENSITIVE_PATTERNS[i].test(filepath)) return true;
    }
    return false;
  }

  function injectSensitiveWarning(mr) {
    if (document.querySelector('.gl-mr-ext-sensitive-warning')) return;

    api('GET', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/diffs?per_page=100')
      .then(function(diffs) {
        if (!diffs || !diffs.length) return;
        var sensitiveFiles = [];
        for (var i = 0; i < diffs.length; i++) {
          var path = diffs[i].new_path || diffs[i].old_path;
          if (path && isSensitiveFile(path)) {
            sensitiveFiles.push(path);
          }
        }
        if (!sensitiveFiles.length) return;
        if (document.querySelector('.gl-mr-ext-sensitive-warning')) return;

        var container = document.querySelector('.gl-mr-actions-ext');
        if (!container) return;

        var badge = document.createElement('span');
        badge.className = 'gl-mr-ext-sensitive-warning';
        badge.textContent = t('sensitiveWarningBadge', [sensitiveFiles.length]);
        badge.title = t('sensitiveWarningHint') + '\n' + sensitiveFiles.join('\n');
        container.insertBefore(badge, container.firstChild);
      })
      .catch(function() {});
  }

  // =========================================================================
  // Git command generator (#12)
  // =========================================================================

  function injectGitCommands(mr) {
    if (document.querySelector('.gl-mr-ext-git-commands')) return;

    var descBlock = document.querySelector('.detail-page-description, .js-detail-page-description, [data-testid="description-content"], [data-testid="merge-request-description"]');
    if (!descBlock) return;

    var branch = mr.source_branch;
    var wrapper = document.createElement('div');
    wrapper.className = 'gl-mr-ext-git-commands';

    var commands = [
      { key: 'gitCmdCheckout', cmd: 'git fetch origin ' + branch + ' && git checkout ' + branch },
      { key: 'gitCmdPull', cmd: 'git checkout ' + branch + ' && git pull origin ' + branch },
      { key: 'gitCmdReset', cmd: 'git checkout ' + branch + ' && git fetch origin ' + branch + ' && git reset --hard origin/' + branch }
    ];

    for (var i = 0; i < commands.length; i++) {
      (function(c) {
        var btn = document.createElement('button');
        btn.className = 'gl-mr-ext-git-cmd-btn';
        btn.textContent = t(c.key);
        btn.title = c.cmd;
        btn.addEventListener('click', function() {
          copyToClipboard(c.cmd, btn);
        });
        wrapper.appendChild(btn);
      })(commands[i]);
    }

    descBlock.appendChild(wrapper);
  }

  function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(function() {
      var orig = btn.textContent;
      btn.textContent = '\u2713';
      setTimeout(function() { btn.textContent = orig; }, 2000);
    }).catch(function() {});
  }

  // =========================================================================
  // Init
  // =========================================================================

  function isGitLab() {
    return !!document.querySelector('meta[content="GitLab"]') || !!document.querySelector('body[data-page]');
  }

  // Listen for background worker messages + API proxy requests
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
      if (msg.type === 'task-result') {
        if (msg.success) {
          showToast(msg.message, 'success');
        } else {
          showToast(msg.message, 'error');
        }
      }
      if (msg.type === 'task-progress') {
        updateTrackerItem(msg.taskId, msg.jobs, msg.status, null, msg.mrTitle);
      }
      // API proxy: background worker relays API calls through content script
      // because only content scripts have access to GitLab session cookies
      if (msg.type === 'api-proxy') {
        api(msg.method, msg.path, msg.body)
          .then(function(data) { sendResponse(data); })
          .catch(function(err) { sendResponse({ _error: err.message }); });
        return true; // async sendResponse
      }
    });

    // Command palette action bridge — receives postMessage from content_proxy.js
    window.addEventListener('message', function(e) {
      if (!e.data || e.data.type !== 'gl-mr-ext-palette-action') return;
      var actionId = e.data.actionId;
      var actionMap = {
        'mr-copy':             function() { return doCopyMr(); },
        'mr-rebase':           function() { return doJustRebase(); },
        'mr-version':          function() { return doVersionBump(); },
        'mr-rebase-version':   function() { return doRebaseVersion(); },
        'mr-automerge':        function() { return doRebaseAutoMerge(); },
        'mr-rebase-force':     function() { return doRebaseForce(); },
        'mr-ship':             function() { return doShip(); },
        'mr-force-ship':       function() { return doForceShip(); },
        'mr-draft':            function() { return doDraftToggle(); },
        'mr-pipeline-restart': function() { return doPipelineRestart(); },
        'mr-pipeline-cancel':  function() { return doPipelineCancel(); },
        'mr-retry-failed':     function() { return doRetryFailed(); },
        'mr-reviewers':        function() { return getSettings().then(function(s) { var list = (s.reviewersList || '').split(/[,\s]+/).map(function(u) { return u.replace(/^@/, '').trim(); }).filter(Boolean); return doReviewers(s.reviewersJob || 'get-reviewers', list); }); },
      };
      // Custom jobs
      if (actionId.indexOf('custom-job-') === 0) {
        var jobIdx = parseInt(actionId.replace('custom-job-', ''));
        getSettings().then(function(s) {
          var job = (s.customJobs || [])[jobIdx];
          if (job && job.jobName) {
            doTriggerJob(job.jobName).catch(function(err) {
              showToast(err.message || String(err), 'error');
            });
          }
        });
        return;
      }
      // Quick comments
      if (actionId.indexOf('quick-comment-') === 0) {
        var qcIdx = parseInt(actionId.replace('quick-comment-', ''));
        getSettings().then(function(s) {
          var qc = (s.quickComments || [])[qcIdx];
          if (qc && qc.text) {
            api('POST', '/projects/' + PROJECT_ID + '/merge_requests/' + MR_IID + '/notes', { body: qc.text })
              .then(function() { showToast(qc.label + ' \u2713', 'success'); })
              .catch(function(err) { showToast(err.message || String(err), 'error'); });
          }
        });
        return;
      }
      if (actionMap[actionId]) {
        actionMap[actionId]().catch(function(err) {
          showToast(err.message || String(err), 'error');
        });
      }
    });
  }

  function init() {
    if (!isGitLab() || !parsePage()) return;

    PROJECT_ID = getProjectId();
    if (!PROJECT_ID) return;

    injectButtons();
    restoreActiveTasks();

    // Re-inject on SPA navigation (GitLab uses turbolinks/pjax)
    var observer = new MutationObserver(function() {
      if (!document.querySelector('.gl-mr-actions-ext') && parsePage()) {
        PROJECT_ID = getProjectId();
        if (PROJECT_ID) injectButtons();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('beforeunload', function() { observer.disconnect(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
