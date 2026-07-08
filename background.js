'use strict';

// Background service worker handles long-running job chains
// that survive page navigation.
// API calls are proxied through content scripts (they have session cookies).

var tasks = {};

// =========================================================================
// First install — set smart defaults
// =========================================================================

chrome.runtime.onInstalled.addListener(function(details) {
  if (details.reason === 'install') {
    // Enable useful buttons by default for new users
    var smartDefaults = {
      btn_rebase_automerge: true,
      btn_pipeline_restart: true,
      btn_pipeline_cancel: true,
      btn_draft_toggle: true,
      btn_retry_failed: true,
      sound_enabled: true,
    };
    chrome.storage.sync.set(smartDefaults);

    // Open welcome page
    chrome.tabs.create({ url: 'welcome.html' });
  }

  if (details.reason === 'update') {
    var currentVersion = chrome.runtime.getManifest().version;
    chrome.storage.sync.set({
      update_version: currentVersion,
      update_previous: details.previousVersion || ''
    });
    chrome.action.setBadgeText({ text: 'NEW' });
    chrome.action.setBadgeBackgroundColor({ color: '#1f75cb' });
  }
});

// =========================================================================
// API proxy — relay calls through content script on a GitLab tab
// =========================================================================

// tabs.sendMessage that cannot hang: a frozen/discarded tab whose content
// script never calls sendResponse would otherwise leave the promise pending forever
function sendMessageWithTimeout(tabId, msg, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error('api-proxy tab timeout'));
    }, timeoutMs);
    chrome.tabs.sendMessage(tabId, msg).then(function(resp) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(resp);
    }, function(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function api(task, method, path, body) {
  var msg = { type: 'api-proxy', method: method, path: path, body: body };
  var isGet = method === 'GET';

  // Try tabs one by one — content script only exists on MR pages
  return chrome.tabs.query({ url: task.gitlabUrl + '/*' }).then(function(tabs) {
    var tabIds = tabs.map(function(t) { return t.id; });
    if (!tabIds.length) throw new Error('No GitLab tab open — keep at least one GitLab tab open.');
    // Prefer the tab that initiated the task — its content script is proven alive.
    // Only if it still matches the GitLab origin (the user may have navigated away).
    var initIdx = task._tabId ? tabIds.indexOf(task._tabId) : -1;
    if (initIdx > 0) {
      tabIds.splice(initIdx, 1);
      tabIds.unshift(task._tabId);
    }

    // Message provably never reached a content script — safe to retry on any method
    function isUndeliveredError(message) {
      return message.indexOf('establish connection') !== -1 ||
        message.indexOf('No tab with id') !== -1;
    }
    // The content script may have received the message and started the request.
    // Retrying a mutating request (job play/retry) here could execute it twice,
    // so only idempotent GETs move on to the next tab.
    function isAmbiguousError(message) {
      return message.indexOf('message port closed') !== -1 ||
        message.indexOf('api-proxy tab timeout') !== -1;
    }

    function tryTab(i) {
      if (i >= tabIds.length) throw new Error('No GitLab tab with content script found. Open any MR page.');
      return sendMessageWithTimeout(tabIds[i], msg, isGet ? 20000 : 60000).then(function(resp) {
        if (resp && resp._error) throw new Error(resp._error);
        return resp;
      }).catch(function(err) {
        var emsg = err.message || '';
        if (isUndeliveredError(emsg) || (isGet && isAmbiguousError(emsg))) {
          return tryTab(i + 1);
        }
        throw err;
      });
    }

    return tryTab(0);
  });
}

// =========================================================================
// Job helpers
// =========================================================================

function findJobByName(task, jobName) {
  return api(task, 'GET', '/projects/' + task.projectId + '/merge_requests/' + task.mrIid + '/pipelines')
    .then(function(pipelines) {
      if (!pipelines.length) return null;
      return api(task, 'GET', '/projects/' + task.projectId + '/pipelines/' + pipelines[0].id + '/jobs?per_page=100');
    })
    .then(function(jobs) {
      if (!jobs) return null;
      // Pick the job with the highest ID (most recent, handles retries)
      var found = null;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].name === jobName) {
          if (!found || jobs[i].id > found.id) found = jobs[i];
        }
      }
      return found;
    });
}

function startJobByName(task, jobName) {
  return findJobByName(task, jobName).then(function(job) {
    if (!job) throw new Error('Job "' + jobName + '" not found in pipeline');

    if (job.status === 'success') {
      return { id: job.id, name: jobName, skipped: true };
    } else if (job.status === 'manual' || job.status === 'skipped') {
      return api(task, 'POST', '/projects/' + task.projectId + '/jobs/' + job.id + '/play')
        .then(function(resp) { return { id: resp.id || job.id, name: jobName }; });
    } else if (job.status === 'failed' || job.status === 'canceled') {
      return api(task, 'POST', '/projects/' + task.projectId + '/jobs/' + job.id + '/retry')
        .then(function(resp) { return { id: resp.id || job.id, name: jobName }; })
        .catch(function(err) {
          // 403 = already retried, refetch to find the new job
          if (err.message && err.message.indexOf('403') !== -1) {
            return findJobByName(task, jobName).then(function(fresh) {
              if (!fresh) throw new Error('Job "' + jobName + '" not found after refetch');
              if (fresh.id !== job.id) return startJobByName(task, jobName);
              throw err;
            });
          }
          throw err;
        });
    } else if (job.status === 'running' || job.status === 'pending' || job.status === 'created') {
      return { id: job.id, name: jobName };
    } else {
      throw new Error('Job "' + jobName + '" has unexpected status: ' + job.status);
    }
  });
}

function waitForJobComplete(task, jobName, maxAttempts) {
  maxAttempts = maxAttempts || 120;
  var attempt = 0;
  function check() {
    attempt++;
    if (task._cancelled) throw new Error('Cancelled by user');
    if (attempt > maxAttempts) throw new Error('Timeout waiting for "' + jobName + '"');
    return new Promise(function(resolve) { setTimeout(resolve, 20000); })
      .then(function() { return findJobByName(task, jobName); })
      .then(function(job) {
        if (!job) throw new Error('Job "' + jobName + '" not found');
        if (job.status === 'success') return job;
        if (job.status === 'failed') throw new Error('Job "' + jobName + '" failed');
        if (job.status === 'canceled') throw new Error('Job "' + jobName + '" canceled');
        return check();
      });
  }
  return check();
}

// =========================================================================
// Job chain runner
// =========================================================================

function runJobChain(taskId) {
  var task = tasks[taskId];
  if (!task || task.currentIndex >= task.jobs.length) {
    if (task) {
      task.status = 'done';
      notifyResult(taskId, true, 'All jobs completed: ' + task.jobs.join(' → '));
    }
    return;
  }

  if (task._cancelled) return;

  var jobName = task.jobs[task.currentIndex];
  task.status = 'running: ' + jobName;
  broadcastProgress(taskId);

  startJobByName(task, jobName)
    .then(function(result) {
      if (result && result.skipped) return;
      return waitForJobComplete(task, jobName);
    })
    .then(function() {
      task.currentIndex++;
      runJobChain(taskId);
    })
    .catch(function(err) {
      task.status = 'error';
      task.error = err.message;
      notifyResult(taskId, false, 'Job chain failed at "' + jobName + '": ' + err.message);
    });
}

// =========================================================================
// Notifications
// =========================================================================

function broadcastToTabs(gitlabUrl, message) {
  chrome.tabs.query({ url: gitlabUrl + '/*' }).then(function(tabs) {
    tabs.forEach(function(tab) {
      chrome.tabs.sendMessage(tab.id, message).catch(function() {});
    });
  }).catch(function() {});
}

function broadcastProgress(taskId) {
  var task = tasks[taskId];
  if (!task) return;
  broadcastToTabs(task.gitlabUrl, {
    type: 'task-progress',
    taskId: taskId,
    jobs: task.jobs,
    status: task.status,
    mrTitle: task.mrTitle,
  });
}

function notifyResult(taskId, success, message) {
  var task = tasks[taskId];
  if (task) {
    broadcastToTabs(task.gitlabUrl, {
      type: 'task-result',
      taskId: taskId,
      success: success,
      message: message,
      jobs: task.jobs,
      mrTitle: task.mrTitle,
    });
  }

  chrome.storage.sync.get({ notifications_enabled: true }, function(s) {
    if (s.notifications_enabled !== false) {
      chrome.notifications.create('task-' + taskId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: success ? 'Job Chain Completed' : 'Job Chain Failed',
        message: message,
      });
    }
  });
}

// =========================================================================
// Message listener
// =========================================================================

// =========================================================================
// Jira API proxy — relay calls through a content script on a Jira tab
// =========================================================================

function jiraApi(jiraUrl, path) {
  var url = jiraUrl + path;
  return chrome.cookies.getAll({ url: jiraUrl }).then(function(cookies) {
    var cookieStr = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
    return fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieStr,
      },
    });
  }).then(function(r) {
    if (!r.ok) {
      var err = new Error(r.status + ' ' + r.statusText);
      err.httpStatus = r.status;
      throw err;
    }
    return r.json();
  });
}

function mapJiraComment(c) {
  return {
    id: c.id,
    author: c.author ? c.author.displayName : '',
    authorId: c.author ? (c.author.accountId || c.author.key || c.author.name || '') : '',
    avatarUrl: c.author && c.author.avatarUrls ? c.author.avatarUrls['24x24'] : '',
    body: c.body || '',
    created: c.created || ''
  };
}

function fetchJiraStatuses(jiraUrl, tickets, showDetails) {
  var results = {};
  var fields = showDetails ? 'status,priority,issuetype' : 'status';
  var authFailed = false;

  function fetchOne(i) {
    if (i >= tickets.length || authFailed) return Promise.resolve(results);
    var ticket = tickets[i];
    return jiraApi(jiraUrl, '/rest/api/2/issue/' + ticket + '?fields=' + fields)
      .then(function(data) {
        if (data && data.fields && data.fields.status) {
          var r = {
            name: data.fields.status.name,
            categoryKey: data.fields.status.statusCategory
              ? data.fields.status.statusCategory.key : 'undefined',
          };
          if (showDetails) {
            r.priority = data.fields.priority ? data.fields.priority.name : '';
            r.priorityIcon = data.fields.priority ? data.fields.priority.iconUrl : '';
            r.type = data.fields.issuetype ? data.fields.issuetype.name : '';
            r.typeIcon = data.fields.issuetype ? data.fields.issuetype.iconUrl : '';
          }
          results[ticket] = r;
        }
      })
      .catch(function(err) {
        var status = err.httpStatus || 0;
        if (status === 401 || status === 403) {
          authFailed = true;
          results._authError = status;
        }
      })
      .then(function() { return fetchOne(i + 1); });
  }

  return fetchOne(0);
}

// Cache for custom field ID mapping (per Jira instance)
var _fieldMapCache = {};

function getFieldMap(jiraUrl) {
  if (_fieldMapCache[jiraUrl]) return Promise.resolve(_fieldMapCache[jiraUrl]);
  return jiraApi(jiraUrl, '/rest/api/2/field')
    .then(function(fields) {
      var map = { epicField: '', sprintField: '' };
      if (Array.isArray(fields)) {
        fields.forEach(function(f) {
          var n = (f.name || '').toLowerCase();
          var id = (f.id || '').toLowerCase();
          if (n === 'epic link' || n === 'epic name' || n.indexOf('epic') !== -1 || id === 'customfield_10014' || id === 'customfield_10008') {
            if (!map.epicField) map.epicField = f.id;
          }
          if (n === 'sprint' || id === 'customfield_10007') {
            if (!map.sprintField) map.sprintField = f.id;
          }
        });
      }
      _fieldMapCache[jiraUrl] = map;
      return map;
    })
    .catch(function() { return { epicField: '', sprintField: '' }; });
}

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'fetch-jira-statuses') {
    fetchJiraStatuses(msg.jiraUrl, msg.tickets, msg.showDetails)
      .then(function(statuses) {
        sendResponse({ statuses: statuses });
      })
      .catch(function(err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }

  if (msg.type === 'fetch-jira-issue') {
    getFieldMap(msg.jiraUrl).then(function(fieldMap) {
      var extraFields = [fieldMap.epicField, fieldMap.sprintField].filter(Boolean).join(',');
      var fieldsParam = 'summary,status,description,assignee,reporter,priority,issuetype,created,updated,labels,attachment,components,versions,fixVersions,resolution';
      if (extraFields) fieldsParam += ',' + extraFields;
      return jiraApi(msg.jiraUrl, '/rest/api/2/issue/' + msg.ticket + '?fields=' + fieldsParam)
        .then(function(data) {
          var f = data.fields || {};
          var attachments = {};
          var attachmentList = [];
          if (f.attachment && f.attachment.length) {
            f.attachment.forEach(function(a) {
              attachments[a.filename] = a.content;
              attachmentList.push({
                filename: a.filename,
                url: a.content,
                size: a.size || 0,
                mimeType: a.mimeType || ''
              });
            });
          }
          // Epic link & Sprint via dynamic field IDs
          var epicLink = '';
          var epicVal = fieldMap.epicField ? f[fieldMap.epicField] : null;
          if (epicVal) {
            epicLink = typeof epicVal === 'string' ? epicVal : (epicVal.key || epicVal.name || epicVal.summary || '');
          }
          var sprint = '';
          var sprintVal = fieldMap.sprintField ? f[fieldMap.sprintField] : null;
          if (sprintVal) {
            if (Array.isArray(sprintVal) && sprintVal.length) {
              var last = sprintVal[sprintVal.length - 1];
              if (typeof last === 'object' && last.name) sprint = last.name;
              else if (typeof last === 'string') {
                var sm = last.match(/name=([^,\]]+)/);
                if (sm) sprint = sm[1];
              }
            } else if (typeof sprintVal === 'string') {
              sprint = sprintVal;
            }
          }
          sendResponse({
            key: data.key,
            summary: f.summary || '',
            status: f.status ? f.status.name : '',
            statusCategoryKey: f.status && f.status.statusCategory ? f.status.statusCategory.key : '',
            description: f.description || '',
            assignee: f.assignee ? f.assignee.displayName : '',
            reporter: f.reporter ? f.reporter.displayName : '',
            priority: f.priority ? f.priority.name : '',
            priorityIcon: f.priority ? f.priority.iconUrl : '',
            type: f.issuetype ? f.issuetype.name : '',
            typeIcon: f.issuetype ? f.issuetype.iconUrl : '',
            created: f.created || '',
            updated: f.updated || '',
            labels: f.labels || [],
            attachments: attachments,
            attachmentList: attachmentList,
            components: (f.components || []).map(function(c) { return c.name; }),
            versions: (f.versions || []).map(function(v) { return v.name; }),
            fixVersions: (f.fixVersions || []).map(function(v) { return v.name; }),
            resolution: f.resolution ? f.resolution.name : '',
            epicLink: epicLink,
            sprint: sprint
          });
        });
    }).catch(function(err) {
      sendResponse({ _error: err.message });
    });
    return true;
  }

  if (msg.type === 'fetch-jira-field-values') {
    // msg.jiraUrl, msg.tickets (array), msg.field (string, e.g. 'fixVersions')
    var field = msg.field || 'fixVersions';
    // For status field, also fetch statusCategory for color coding
    var apiFields = field === 'status' ? 'status' : field;
    var results = {};
    var authFailed = false;
    function fetchField(i) {
      if (i >= msg.tickets.length || authFailed) return Promise.resolve(results);
      var ticket = msg.tickets[i];
      return jiraApi(msg.jiraUrl, '/rest/api/2/issue/' + ticket + '?fields=' + apiFields)
        .then(function(data) {
          var val = data && data.fields ? data.fields[field] : null;
          var values = [];
          var categoryKey = '';
          if (Array.isArray(val)) {
            val.forEach(function(v) {
              values.push(typeof v === 'object' && v.name ? v.name : String(v));
            });
          } else if (val && typeof val === 'object' && val.name) {
            values.push(val.name);
            if (val.statusCategory) categoryKey = val.statusCategory.key || '';
          } else if (val) {
            values.push(String(val));
          }
          if (values.length) {
            results[ticket] = { values: values };
            if (categoryKey) results[ticket].categoryKey = categoryKey;
          }
        })
        .catch(function(err) {
          var status = err.httpStatus || 0;
          if (status === 401 || status === 403) {
            authFailed = true;
            results._authError = status;
          }
        })
        .then(function() { return fetchField(i + 1); });
    }
    fetchField(0).then(function() {
      sendResponse({ values: results });
    }).catch(function(err) {
      sendResponse({ _error: err.message });
    });
    return true;
  }

  if (msg.type === 'search-jira-assignable') {
    jiraApi(msg.jiraUrl, '/rest/api/2/user/assignable/search?issueKey=' + encodeURIComponent(msg.ticket) + '&username=' + encodeURIComponent(msg.query) + '&maxResults=10')
      .then(function(users) {
        sendResponse({
          users: users.map(function(u) {
            return { key: u.key || u.name, name: u.displayName, avatar: u.avatarUrls ? u.avatarUrls['24x24'] : '' };
          })
        });
      })
      .catch(function(err) { sendResponse({ _error: err.message }); });
    return true;
  }

  if (msg.type === 'fetch-jira-versions') {
    var projectKey = msg.ticket.replace(/-\d+$/, '');
    jiraApi(msg.jiraUrl, '/rest/api/2/project/' + projectKey + '/versions')
      .then(function(versions) {
        var list = (versions || []).filter(function(v) { return !v.archived; })
          .map(function(v) { return { name: v.name, released: !!v.released }; });
        sendResponse({ versions: list });
      })
      .catch(function(err) { sendResponse({ _error: err.message }); });
    return true;
  }

  if (msg.type === 'set-jira-fix-versions') {
    var fvUrl = msg.jiraUrl + '/rest/api/2/issue/' + msg.ticket;
    chrome.cookies.getAll({ url: msg.jiraUrl }).then(function(cookies) {
      var cookieStr = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
      return fetch(fvUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookieStr },
        body: JSON.stringify({ fields: { fixVersions: msg.versions.map(function(v) { return { name: v }; }) } })
      });
    }).then(function(r) {
      if (r.status === 204 || r.ok) {
        sendResponse({ success: true });
      } else {
        return r.text().then(function(text) { throw new Error(r.status + ' ' + text); });
      }
    }).catch(function(err) { sendResponse({ _error: err.message }); });
    return true;
  }

  if (msg.type === 'set-jira-assignee') {
    var url = msg.jiraUrl + '/rest/api/2/issue/' + msg.ticket;
    chrome.cookies.getAll({ url: msg.jiraUrl }).then(function(cookies) {
      var cookieStr = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
      return fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookieStr },
        body: JSON.stringify({ fields: { assignee: msg.username ? { name: msg.username } : null } })
      });
    }).then(function(r) {
      if (r.status === 204 || r.ok) {
        sendResponse({ success: true });
      } else {
        return r.text().then(function(text) { throw new Error(r.status + ' ' + text); });
      }
    }).catch(function(err) { sendResponse({ _error: err.message }); });
    return true;
  }

  if (msg.type === 'fetch-jira-transitions') {
    jiraApi(msg.jiraUrl, '/rest/api/2/issue/' + msg.ticket + '/transitions')
      .then(function(data) {
        var transitions = (data.transitions || []).map(function(t) {
          return {
            id: t.id,
            name: t.name,
            statusName: t.to ? t.to.name : '',
            statusCategoryKey: t.to && t.to.statusCategory ? t.to.statusCategory.key : ''
          };
        });
        sendResponse({ transitions: transitions });
      })
      .catch(function(err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }

  if (msg.type === 'fetch-jira-comments') {
    var startAt = msg.startAt || 0;
    var maxResults = msg.maxResults || 5;
    jiraApi(msg.jiraUrl, '/rest/api/2/issue/' + msg.ticket + '/comment?orderBy=-created&startAt=' + startAt + '&maxResults=' + maxResults)
      .then(function(data) {
        var comments = (data.comments || []).map(mapJiraComment);
        sendResponse({ comments: comments, total: data.total || 0 });
      })
      .catch(function(err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }

  if (msg.type === 'fetch-jira-myself') {
    jiraApi(msg.jiraUrl, '/rest/api/2/myself')
      .then(function(data) {
        sendResponse({ id: data.accountId || data.key || data.name || '' });
      })
      .catch(function(err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }

  if (msg.type === 'delete-jira-comment') {
    var deleteUrl = msg.jiraUrl + '/rest/api/2/issue/' + msg.ticket + '/comment/' + msg.commentId;
    chrome.cookies.getAll({ url: msg.jiraUrl }).then(function(cookies) {
      var cookieStr = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
      return fetch(deleteUrl, {
        method: 'DELETE',
        headers: { 'Cookie': cookieStr, 'X-Atlassian-Token': 'no-check' }
      });
    }).then(function(r) {
      if (r.status === 204 || r.ok) {
        sendResponse({ success: true });
      } else {
        return r.text().then(function(text) { throw new Error(r.status + ' ' + text); });
      }
    }).catch(function(err) {
      sendResponse({ _error: err.message });
    });
    return true;
  }

  if (msg.type === 'post-jira-comment') {
    var commentUrl = msg.jiraUrl + '/rest/api/2/issue/' + msg.ticket + '/comment';
    chrome.cookies.getAll({ url: msg.jiraUrl }).then(function(cookies) {
      var cookieStr = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
      return fetch(commentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookieStr, 'X-Atlassian-Token': 'no-check' },
        body: JSON.stringify({ body: msg.text })
      });
    }).then(function(r) {
      if (!r.ok) {
        return r.text().then(function(text) { throw new Error(r.status + ' ' + text); });
      }
      return r.json();
    }).then(function(c) {
      sendResponse({ comment: mapJiraComment(c) });
    }).catch(function(err) {
      sendResponse({ _error: err.message });
    });
    return true;
  }

  if (msg.type === 'do-jira-transition') {
    var url = msg.jiraUrl + '/rest/api/2/issue/' + msg.ticket + '/transitions';
    chrome.cookies.getAll({ url: msg.jiraUrl }).then(function(cookies) {
      var cookieStr = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookieStr },
        body: JSON.stringify({ transition: { id: msg.transitionId } })
      });
    }).then(function(r) {
      if (r.status === 204 || r.ok) {
        sendResponse({ success: true });
      } else {
        return r.text().then(function(text) {
          throw new Error(r.status + ' ' + text);
        });
      }
    }).catch(function(err) {
      sendResponse({ _error: err.message });
    });
    return true;
  }

  if (msg.type === 'start-job-chain') {
    var taskId = 'task-' + Date.now();
    tasks[taskId] = {
      jobs: msg.jobs,
      currentIndex: 0,
      gitlabUrl: msg.gitlabUrl,
      projectId: msg.projectId,
      mrIid: msg.mrIid,
      mrTitle: msg.mrTitle || ('!' + msg.mrIid),
      status: 'starting',
      error: null,
      _tabId: sender.tab ? sender.tab.id : null,
    };
    runJobChain(taskId);
    sendResponse({ taskId: taskId });
    return true;
  }

  if (msg.type === 'get-task-status') {
    var task = tasks[msg.taskId];
    sendResponse(task ? { status: task.status, error: task.error } : { status: 'not_found' });
    return true;
  }

  if (msg.type === 'cancel-task') {
    var ct = tasks[msg.taskId];
    if (ct && ct.status !== 'done' && ct.status !== 'error') {
      ct.status = 'error';
      ct.error = 'Cancelled by user';
      ct._cancelled = true;
      broadcastProgress(msg.taskId);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'open-options') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    return;
  }

  if (msg.type === 'generate-standup') {
    var standupUrl = msg.gitlabUrl;
    var fakeTask = { gitlabUrl: standupUrl, _tabId: sender.tab ? sender.tab.id : null };

    // Guarantee exactly one response so the modal never spins forever
    var standupDone = false;
    var standupWatchdog = setTimeout(function() {
      standupRespond({ _error: 'Timed out generating the report (180s). Check that GitLab is reachable and reload the tab.' });
    }, 180000);
    function standupRespond(payload) {
      if (standupDone) return;
      standupDone = true;
      clearTimeout(standupWatchdog);
      try { sendResponse(payload); } catch (e) {}
    }

    // Get current user
    api(fakeTask, 'GET', '/user').then(function(user) {
      if (!user || !user.id) throw new Error('Cannot get current user');
      var userId = user.id;
      var username = user.username;
      // Use provided date or default to today (local dates, no UTC conversion)
      function localDateStr(d) {
        return d.getFullYear() + '-' +
          (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' +
          (d.getDate() < 10 ? '0' : '') + d.getDate();
      }
      var targetDate = msg.date ? new Date(msg.date + 'T12:00:00') : new Date();
      var todayStr = msg.date || localDateStr(targetDate);
      // Next day
      var nextDay = new Date(todayStr + 'T12:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      var nextDayStr = localDateStr(nextDay);
      // Day before (events API "after" is exclusive)
      var dayBefore = new Date(todayStr + 'T12:00:00');
      dayBefore.setDate(dayBefore.getDate() - 1);
      var dayBeforeStr = localDateStr(dayBefore);

      // Helper: fetch all event pages for the day (up to 5 pages)
      function fetchAllEvents(page, collected) {
        if (page > 5) return Promise.resolve(collected);
        return api(fakeTask, 'GET', '/users/' + userId + '/events?after=' + dayBeforeStr + '&before=' + nextDayStr + '&per_page=100&page=' + page)
          .then(function(events) {
            if (!events || !events.length) return collected;
            collected = collected.concat(events);
            if (events.length < 100) return collected;
            return fetchAllEvents(page + 1, collected);
          });
      }

      // Fetch activity in parallel
      return Promise.all([
        // MRs created on target date
        api(fakeTask, 'GET', '/merge_requests?scope=all&state=all&author_id=' + userId + '&created_after=' + todayStr + 'T00:00:00Z&created_before=' + nextDayStr + 'T00:00:00Z&per_page=50'),
        // MRs merged on target date
        api(fakeTask, 'GET', '/merge_requests?scope=all&state=merged&author_id=' + userId + '&updated_after=' + todayStr + 'T00:00:00Z&updated_before=' + nextDayStr + 'T00:00:00Z&per_page=50'),
        // All events for target date (paginated)
        fetchAllEvents(1, []),
        // Open MRs updated on target date (for "in progress")
        api(fakeTask, 'GET', '/merge_requests?scope=all&state=opened&author_id=' + userId + '&updated_after=' + todayStr + 'T00:00:00Z&updated_before=' + nextDayStr + 'T00:00:00Z&per_page=50'),
      ]).then(function(results) {
        var createdMrs = results[0] || [];
        var mergedMrs = results[1] || [];
        var events = results[2] || [];
        var activeMrs = results[3] || [];

        // Filter created on target date (double-check)
        createdMrs = createdMrs.filter(function(mr) {
          return mr.created_at && mr.created_at.indexOf(todayStr) === 0;
        });

        // Filter merged on target date (double-check merged_at)
        mergedMrs = mergedMrs.filter(function(mr) {
          return mr.merged_at && mr.merged_at.indexOf(todayStr) === 0;
        });

        // Filter events to target date only
        events = events.filter(function(ev) {
          return ev.created_at && ev.created_at.indexOf(todayStr) === 0;
        });

        // Collect created MR IDs to avoid duplicates
        var createdIids = {};
        createdMrs.forEach(function(mr) { createdIids[mr.id] = true; });
        var mergedIids = {};
        mergedMrs.forEach(function(mr) { mergedIids[mr.id] = true; });

        // Commented MRs (deduplicate by note.id to avoid double-counting)
        var commentedMap = {};
        var seenNoteIds = {};
        events.forEach(function(ev) {
          if (ev.action_name === 'commented on' && ev.note && ev.note.noteable_type === 'MergeRequest') {
            if (seenNoteIds[ev.note.id]) return;
            seenNoteIds[ev.note.id] = true;
            var mrIid = ev.note.noteable_iid;
            var projId = ev.project_id;
            var key = projId + '!' + mrIid;
            if (!commentedMap[key]) {
              commentedMap[key] = { iid: mrIid, projectId: projId, count: 0, targetTitle: ev.target_title || '' };
            }
            commentedMap[key].count++;
          }
        });

        // Approved MRs
        var approvedMap = {};
        events.forEach(function(ev) {
          if (ev.action_name === 'approved' && ev.target_type === 'MergeRequest') {
            var key = ev.project_id + '!' + ev.target_iid;
            approvedMap[key] = { iid: ev.target_iid, title: ev.target_title || '' };
          }
        });

        // Collect unique project IDs from events and resolve names
        var projectIds = {};
        events.forEach(function(ev) {
          if (ev.project_id) projectIds[ev.project_id] = '';
        });

        // Fetch project names in parallel
        var pidList = Object.keys(projectIds);
        return (pidList.length ? Promise.all(pidList.map(function(pid) {
          return api(fakeTask, 'GET', '/projects/' + pid + '?simple=true').then(function(proj) {
            if (proj && proj.path_with_namespace) projectIds[pid] = proj.path_with_namespace;
          }).catch(function() {});
        })) : Promise.resolve()).then(function() {

        function projName(ev) { return projectIds[ev.project_id] || ''; }

        // Pushes — group by project + branch
        var pushMap = {};
        events.forEach(function(ev) {
          if (ev.action_name === 'pushed to' || ev.action_name === 'pushed new') {
            var ref = ev.push_data ? ev.push_data.ref : '';
            var refType = ev.push_data ? ev.push_data.ref_type : 'branch';
            if (refType === 'tag') return;
            var pName = projName(ev);
            var key = (pName || ev.project_id) + ':' + ref;
            if (!pushMap[key]) {
              pushMap[key] = { ref: ref, project: pName, commits: 0 };
            }
            var commitCount = ev.push_data ? (ev.push_data.commit_count || 1) : 1;
            pushMap[key].commits += commitCount;
          }
        });

        // Tags
        var tags = [];
        events.forEach(function(ev) {
          if (ev.push_data && ev.push_data.ref_type === 'tag') {
            tags.push({ tag: ev.push_data.ref, project: projName(ev) });
          }
        });

        // Build report
        var lines = [];

        if (createdMrs.length) {
          lines.push('Created:');
          createdMrs.forEach(function(mr) {
            var proj = mr.references && mr.references.full ? mr.references.full.split('!')[0] : '';
            lines.push('  - !' + mr.iid + ' ' + mr.title + (proj ? ' (' + proj.replace(/\/$/, '') + ')' : ''));
          });
          lines.push('');
        }

        if (mergedMrs.length) {
          lines.push('Merged:');
          mergedMrs.forEach(function(mr) {
            var proj = mr.references && mr.references.full ? mr.references.full.split('!')[0] : '';
            lines.push('  - !' + mr.iid + ' ' + mr.title + (proj ? ' (' + proj.replace(/\/$/, '') + ')' : ''));
          });
          lines.push('');
        }

        var commentedKeys = Object.keys(commentedMap);
        if (commentedKeys.length) {
          lines.push('Commented:');
          commentedKeys.forEach(function(key) {
            var r = commentedMap[key];
            lines.push('  - !' + r.iid + ' ' + (r.targetTitle || '') + ' \u2014 ' + r.count + ' comment' + (r.count > 1 ? 's' : ''));
          });
          lines.push('');
        }

        var approvedKeys = Object.keys(approvedMap);
        if (approvedKeys.length) {
          lines.push('Approved:');
          approvedKeys.forEach(function(key) {
            var a = approvedMap[key];
            lines.push('  - !' + a.iid + ' ' + a.title);
          });
          lines.push('');
        }

        var pushKeys = Object.keys(pushMap);
        if (pushKeys.length) {
          lines.push('Pushed:');
          pushKeys.forEach(function(key) {
            var p = pushMap[key];
            lines.push('  - ' + (p.project ? p.project + ' - ' : '') + p.ref + ' \u2014 ' + p.commits + ' commit' + (p.commits > 1 ? 's' : ''));
          });
          lines.push('');
        }

        if (tags.length) {
          lines.push('Tags:');
          tags.forEach(function(t) {
            lines.push('  - ' + t.tag + (t.project ? ' (' + t.project + ')' : ''));
          });
          lines.push('');
        }

        // In progress — open MRs updated on target date, excluding created/merged
        var inProgress = activeMrs.filter(function(mr) {
          return !createdIids[mr.id] && !mergedIids[mr.id];
        });
        if (inProgress.length) {
          lines.push('In progress:');
          inProgress.forEach(function(mr) {
            var proj = mr.references && mr.references.full ? mr.references.full.split('!')[0] : '';
            var status = '';
            if (mr.pipeline && mr.pipeline.status) status = ' \u2014 pipeline ' + mr.pipeline.status;
            lines.push('  - !' + mr.iid + ' ' + mr.title + (proj ? ' (' + proj.replace(/\/$/, '') + ')' : '') + status);
          });
        }

        if (!lines.length) {
          lines.push('No activity for this day.');
        }

        // Enrich lines with Jira ticket titles if configured.
        // Any failure here must degrade to the plain report, never to a hang.
        chrome.storage.sync.get({ jira_url: '', jira_ticket_regex: '', standup_jira_enrich: true }, function(jiraSettings) {
          try {
          var jiraUrl = (jiraSettings.jira_url || '').replace(/\/+$/, '');
          if (!jiraUrl || jiraSettings.standup_jira_enrich === false) {
            standupRespond({ text: lines.join('\n') });
            return;
          }
          var ticketPattern;
          try {
            ticketPattern = jiraSettings.jira_ticket_regex ? new RegExp(jiraSettings.jira_ticket_regex, 'g') : /[A-Z][A-Z0-9]+-\d+/g;
          } catch(e) {
            ticketPattern = /[A-Z][A-Z0-9]+-\d+/g;
          }
          // Collect unique tickets from all lines
          var allText = lines.join('\n');
          var ticketSet = {};
          var m;
          while ((m = ticketPattern.exec(allText)) !== null) {
            if (m[0]) ticketSet[m[0]] = true;
            // A custom regex matching the empty string would never advance lastIndex
            if (m.index === ticketPattern.lastIndex) ticketPattern.lastIndex++;
          }
          var tickets = Object.keys(ticketSet);
          if (!tickets.length) {
            standupRespond({ text: lines.join('\n') });
            return;
          }
          // Fetch Jira summaries (up to 5 concurrent)
          var ticketSummaries = {};
          var fetchQueue = tickets.slice();
          function fetchNextBatch() {
            if (!fetchQueue.length) return Promise.resolve();
            var batch = fetchQueue.splice(0, 5);
            return Promise.all(batch.map(function(ticket) {
              return jiraApi(jiraUrl, '/rest/api/2/issue/' + ticket + '?fields=summary')
                .then(function(data) {
                  if (data && data.fields && data.fields.summary) {
                    ticketSummaries[ticket] = data.fields.summary;
                  }
                }).catch(function() {});
            })).then(function() {
              return fetchNextBatch();
            });
          }
          fetchNextBatch().then(function() {
            // Annotate lines: append Jira summary after ticket ID
            if (Object.keys(ticketSummaries).length) {
              try {
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (line.indexOf('  - ') !== 0) continue;
                // Reset regex for each line
                var lp;
                try {
                  lp = jiraSettings.jira_ticket_regex ? new RegExp(jiraSettings.jira_ticket_regex, 'g') : /[A-Z][A-Z0-9]+-\d+/g;
                } catch(e2) {
                  lp = /[A-Z][A-Z0-9]+-\d+/g;
                }
                var lineTickets = [];
                var lm;
                while ((lm = lp.exec(line)) !== null) {
                  if (ticketSummaries[lm[0]] && lineTickets.indexOf(lm[0]) === -1) {
                    lineTickets.push(lm[0]);
                  }
                  if (lm.index === lp.lastIndex) lp.lastIndex++;
                }
                if (lineTickets.length) {
                  var annotations = lineTickets.map(function(t) { return '[' + t + ': ' + ticketSummaries[t] + ']'; });
                  lines[i] = line + '\n    ' + annotations.join(' ');
                }
              }
              } catch(annotateErr) { /* keep un-annotated lines */ }
            }
            standupRespond({ text: lines.join('\n') });
          }).catch(function() {
            standupRespond({ text: lines.join('\n') });
          });
          } catch(enrichErr) {
            // Jira enrichment is optional — fall back to the plain report
            standupRespond({ text: lines.join('\n') });
          }
        });
      }); // end projectIds resolve
      }); // end main Promise.all
    }).catch(function(err) {
      standupRespond({ _error: err.message || String(err) });
    });
    return true;
  }

  if (msg.type === 'get-active-tasks') {
    var active = [];
    for (var id in tasks) {
      var t = tasks[id];
      if (t.status !== 'done' && t.status !== 'error') {
        active.push({ taskId: id, jobs: t.jobs, status: t.status, mrTitle: t.mrTitle });
      }
    }
    sendResponse(active);
    return true;
  }
});
