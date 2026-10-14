(function() {
  'use strict';

  if (window.GlReviewImportUI) return;
  var active = null;
  var confirmClose = false;
  var outcomeKeys = {
    ready: 'aiReviewImportReady', invalid: 'aiReviewImportInvalid', duplicate: 'aiReviewImportDuplicate',
    published: 'aiReviewImportPublished', draft: 'aiReviewImportDraft', failed: 'aiReviewImportFailed',
    unknown: 'aiReviewImportUnknown', skipped: 'aiReviewImportSkipped'
  };

  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function button(state, key, handler, className) {
    var el = element('button', 'gl-review-button' + (className ? ' ' + className : ''), state.t(key));
    el.type = 'button';
    el.setAttribute('data-import-action', key);
    el.addEventListener('click', handler);
    return el;
  }

  function samePage(context) {
    try {
      var expected = new URL(context.webUrl);
      var path = expected.pathname.replace(/\/$/, '');
      return window.location.origin === expected.origin &&
        (window.location.pathname === path || window.location.pathname.indexOf(path + '/') === 0);
    } catch (error) { return false; }
  }

  function current(state) {
    if (active !== state) return false;
    if (samePage(state.context)) return true;
    close(true);
    return false;
  }

  function checkCurrent(state, run) {
    if (current(state) && state.run === run && !state.controller.signal.aborted) return;
    var error = new Error('Cancelled');
    error.name = 'AbortError';
    throw error;
  }

  function close(force) {
    if (!active) return true;
    var dirty = active.input.value.trim() || active.editor || active.busy === 'sending';
    var completed = active.plan && active.plan.items.length && !active.editor && !active.busy && active.plan.items.every(function(item) {
      var result = active.results.get(item.id) || item;
      return ['published', 'draft', 'duplicate'].indexOf(result.status) !== -1 && (!result.resolveStatus || result.resolveStatus === 'resolved');
    });
    if (force !== true && confirmClose && dirty && !completed && typeof window.confirm === 'function' &&
      !window.confirm(active.t(active.busy === 'sending' ? 'aiReviewConfirmStopAndClose' : 'aiReviewConfirmDiscard'))) return false;
    var old = active;
    active = null;
    if (old.controller) old.controller.abort();
    old.overlay.remove();
    document.removeEventListener('keydown', old.onKeydown, true);
    if (old.previousFocus && old.previousFocus.isConnected) old.previousFocus.focus();
    return true;
  }

  function setStatus(state, text, error) {
    state.status.textContent = text;
    state.status.classList.toggle('gl-review-error', !!error);
  }

  function warnings(state, notices) {
    state.warning.replaceChildren();
    state.warning.hidden = !notices.length;
    if (!notices.length) return;
    state.warning.appendChild(element('strong', '', state.t('aiReviewImportWarning')));
    var list = element('ul');
    notices.forEach(function(text) { list.appendChild(element('li', '', text)); });
    state.warning.appendChild(list);
  }

  function selectable(state, item) {
    var result = state.results.get(item.id);
    return item.status === 'ready' && (!result || result.status === 'failed' || result.status === 'skipped');
  }

  function editable(state, item) {
    var result = state.results.get(item.id) || item;
    return item.editable !== false && ['ready', 'invalid', 'failed', 'skipped'].indexOf(result.status) !== -1;
  }

  function canResolve(item) {
    return item.type === 'reply' && item.replyTo && item.replyTo.resolvable === true && item.replyTo.resolved === false;
  }

  function editButton(state, item) {
    var el = button(state, 'aiReviewImportEdit', function() { startEditor(state, item); }, 'gl-review-icon-button gl-review-import-edit');
    el.dataset.importEdit = item.id;
    el.setAttribute('title', state.t('aiReviewImportEdit'));
    el.setAttribute('aria-label', state.t('aiReviewImportEdit'));
    var icon = element('span', 'gl-review-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15v5Z"/></svg>';
    el.replaceChildren(icon);
    return el;
  }

  function updateActions(state) {
    var busy = !!state.busy;
    var locked = busy || !!state.editor;
    var count = state.selected.size;
    state.copyPrompt.disabled = locked;
    state.copyReplyPrompt.disabled = locked;
    state.copyFormat.disabled = locked;
    state.validate.disabled = locked || !state.input.value.trim();
    state.input.readOnly = state.busy === 'sending' || !!state.editor;
    state.publish.disabled = locked || !state.plan || !count;
    state.drafts.disabled = state.publish.disabled || !!(state.plan && state.plan.draftSupported === false);
    state.select.disabled = locked || !state.plan || !state.plan.items.some(function(item) { return selectable(state, item); });
    state.clear.disabled = locked || !count;
    state.add.disabled = locked || !state.plan || state.plan.items.length >= 200;
    state.add.setAttribute('title', state.t(state.plan && state.plan.items.length >= 200 ? 'aiReviewImportCommentLimit' : 'aiReviewImportAddComment'));
    state.stop.hidden = state.busy !== 'sending';
    state.stop.disabled = !!state.stopping;
    state.count.textContent = state.t('aiReviewSelectedCount', [count]);
    state.replyHint.hidden = !state.plan || !state.plan.items.some(function(item) { return item.type === 'reply'; });
    state.list.querySelectorAll('[data-import-item]').forEach(function(check) {
      var item = state.plan && state.plan.items.find(function(item) { return item.id === check.dataset.importItem; });
      check.disabled = locked || !item || !selectable(state, item);
      check.checked = state.selected.has(check.dataset.importItem);
    });
    state.list.querySelectorAll('[data-import-resolve]').forEach(function(check) {
      var item = state.plan.items.find(function(item) { return item.id === check.dataset.importResolve; });
      check.disabled = locked || !item || !canResolve(item) || !selectable(state, item) || !state.selected.has(item.id);
      check.checked = state.resolveSelected.has(check.dataset.importResolve);
    });
    state.list.querySelectorAll('[data-import-edit]').forEach(function(edit) { edit.disabled = locked; });
    if (state.editorInput) state.editorInput.readOnly = busy;
    if (state.saveEdit) state.saveEdit.disabled = busy;
    state.dialog.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function safeLink(state, href) {
    try {
      var url = new URL(href, state.context.webUrl);
      return /^https?:$/.test(url.protocol) && url.origin === state.context.origin ? url.href : null;
    } catch (error) { return null; }
  }

  function replyContext(state, item) {
    var original = item.replyTo;
    if (!original) return null;
    var box = element('section', 'gl-review-import-original');
    var heading = element('div', 'gl-review-import-original-heading');
    heading.appendChild(element('strong', '', state.t('aiReviewImportOriginalComment')));
    var author = original.author;
    var name = typeof author === 'string' ? author : author && (author.username ? '@' + author.username : author.name);
    if (name) heading.appendChild(element('span', 'gl-review-muted', name));
    if (typeof original.resolved === 'boolean') heading.appendChild(element('span', 'gl-review-muted', state.t(original.resolved ? 'aiReviewResolved' : 'aiReviewUnresolved')));
    var href = original.url && safeLink(state, original.url);
    if (href) {
      var link = element('a', 'gl-review-link', '↗');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', state.t('aiReviewLink'));
      heading.appendChild(link);
    }
    box.appendChild(heading);
    if (original.path) box.appendChild(element('p', 'gl-review-path gl-review-import-original-path', original.path + (original.line ? ':' + original.line : '')));
    box.appendChild(element('pre', 'gl-review-note-text', typeof original.body === 'string' ? original.body : ''));
    return box;
  }

  function render(state) {
    state.editorInput = null;
    state.saveEdit = null;
    state.list.replaceChildren();
    if (!state.plan) {
      state.list.appendChild(element('p', 'gl-review-muted', state.t('aiReviewImportEmpty')));
      updateActions(state);
      return;
    }
    state.plan.items.forEach(function(item) {
      var result = state.results.get(item.id) || item;
      var card = element('article', 'gl-review-thread gl-review-import-item');
      card.setAttribute('data-import-result', result.status);
      var heading = element('div', 'gl-review-thread-heading');
      var label = element('label', 'gl-review-thread-label');
      var check = element('input');
      check.type = 'checkbox';
      check.dataset.importItem = item.id;
      check.setAttribute('aria-label', item.type === 'reply' ? state.t('aiReviewImportReply') + (item.note_id ? ' #' + item.note_id : '') : item.path ? item.path + ':' + item.line : state.t('aiReviewGeneral'));
      check.addEventListener('change', function() {
        if (state.busy || state.editor || !selectable(state, item)) return;
        if (check.checked) state.selected.add(item.id); else state.selected.delete(item.id);
        updateActions(state);
      });
      label.appendChild(check);
      label.appendChild(element('span', 'gl-review-badge', state.t(outcomeKeys[result.status] || 'aiReviewImportInvalid')));
      if (item.type === 'reply') {
        label.appendChild(element('span', 'gl-review-muted', state.t('aiReviewImportReply')));
        if (item.note_id) label.appendChild(element('span', 'gl-review-path', '#' + item.note_id));
      } else if (item.path) {
        label.appendChild(element('span', 'gl-review-path', item.path));
        label.appendChild(element('span', 'gl-review-muted', state.t(item.side === 'old' ? 'aiReviewImportOldLine' : 'aiReviewImportNewLine', [item.line])));
      } else label.appendChild(element('span', 'gl-review-muted', state.t('aiReviewGeneral')));
      heading.appendChild(label);
      if (editable(state, item)) heading.appendChild(editButton(state, item));
      var href = (result.url || item.existingUrl) && safeLink(state, result.url || item.existingUrl);
      if (href) {
        var link = element('a', 'gl-review-link', '↗');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', state.t('aiReviewLink'));
        heading.appendChild(link);
      }
      card.appendChild(heading);
      var body = element('div', 'gl-review-note');
      if (item.type === 'reply') {
        var original = replyContext(state, item);
        if (original) body.appendChild(original);
        body.appendChild(element('strong', 'gl-review-import-reply-label', state.t('aiReviewImportReplyText')));
      }
      if (typeof item.code === 'string') body.appendChild(element('pre', 'gl-review-import-code', item.code));
      if (state.editor && state.editor.id === item.id && !state.editor.add) body.appendChild(renderEditor(state));
      else body.appendChild(element('pre', 'gl-review-note-text gl-review-import-text', typeof item.body === 'string' ? item.body : ''));
      if (canResolve(item)) {
        var resolveLabel = element('label', 'gl-review-description-toggle gl-review-import-resolve');
        var resolveCheck = element('input');
        resolveCheck.type = 'checkbox';
        resolveCheck.dataset.importResolve = item.id;
        resolveCheck.addEventListener('change', function() {
          if (state.busy || state.editor || !selectable(state, item) || !state.selected.has(item.id)) return;
          if (resolveCheck.checked) state.resolveSelected.add(item.id); else state.resolveSelected.delete(item.id);
          updateActions(state);
        });
        resolveLabel.appendChild(resolveCheck);
        resolveLabel.appendChild(element('span', '', state.t('aiReviewImportResolveAfterReply')));
        body.appendChild(resolveLabel);
      }
      if (result.message) body.appendChild(element('p', 'gl-review-import-message gl-review-muted', result.message));
      if (result.resolveStatus) {
        var resolveKey = result.resolveStatus === 'resolved' ? 'aiReviewImportResolveSuccess' : result.resolveStatus === 'unknown' ? 'aiReviewImportResolveUnknown' : 'aiReviewImportResolveFailed';
        body.appendChild(element('p', 'gl-review-import-message ' + (result.resolveStatus === 'resolved' ? 'gl-review-muted' : 'gl-review-error'), state.t(resolveKey)));
        if (result.resolveMessage) body.appendChild(element('p', 'gl-review-import-message gl-review-muted', result.resolveMessage));
      }
      if (result.status === 'unknown') body.appendChild(element('p', 'gl-review-import-message gl-review-error', state.t('aiReviewImportUnsafeRetry')));
      card.appendChild(body);
      state.list.appendChild(card);
    });
    if (state.editor && state.editor.add) {
      var newCard = element('article', 'gl-review-thread gl-review-import-item gl-review-import-new');
      newCard.appendChild(element('div', 'gl-review-thread-heading', state.t('aiReviewImportAddComment') + ' · ' + state.t('aiReviewGeneral')));
      var newBody = element('div', 'gl-review-note');
      newBody.appendChild(renderEditor(state));
      newCard.appendChild(newBody);
      state.list.appendChild(newCard);
    }
    updateActions(state);
  }

  function renderEditor(state) {
    var editor = state.editor;
    var form = element('div', 'gl-review-import-editor');
    var label = element('label', 'gl-review-import-editor-label', state.t('aiReviewImportEditorLabel'));
    label.htmlFor = 'gl-review-import-editor-input';
    form.appendChild(label);
    var input = state.editorInput = element('textarea', 'gl-review-import-editor-input');
    input.id = 'gl-review-import-editor-input';
    input.value = editor.body;
    input.setAttribute('aria-label', state.t('aiReviewImportEditorLabel'));
    input.addEventListener('input', function() { if (state.editor === editor && !state.busy) editor.body = input.value; });
    form.appendChild(input);
    form.appendChild(element('p', 'gl-review-muted gl-review-import-edit-hint', state.t('aiReviewImportEditingHint')));
    if (editor.error) {
      var error = element('p', 'gl-review-error gl-review-import-edit-hint', editor.error);
      error.setAttribute('role', 'alert');
      form.appendChild(error);
    }
    var actions = element('div', 'gl-review-import-editor-actions');
    state.saveEdit = button(state, 'aiReviewImportSaveEdit', function() { saveEditor(state); });
    actions.appendChild(state.saveEdit);
    actions.appendChild(button(state, 'aiReviewImportCancelEdit', function() { cancelEditor(state); }));
    form.appendChild(actions);
    return form;
  }

  function startEditor(state, item) {
    if (!current(state) || state.busy || state.editor || !state.plan || (item && !editable(state, item))) return;
    if (!item && state.plan.items.length >= 200) {
      setStatus(state, state.t('aiReviewImportCommentLimit'), true);
      return;
    }
    var id = item && item.id;
    if (!item) {
      do { id = 'manual-' + (++state.manualId); } while (state.plan.items.some(function(existing) { return existing.id === id; }));
    }
    state.editor = { id: id, add: !item, body: item && typeof item.body === 'string' ? item.body : '' };
    render(state);
    state.editorInput.focus();
  }

  function cancelEditor(state) {
    if (!current(state) || !state.editor) return;
    state.run++;
    if (state.controller) state.controller.abort();
    state.busy = '';
    state.editor = null;
    setStatus(state, state.t('aiReviewImportChecked', [state.selected.size]));
    render(state);
  }

  function saveEditor(state) {
    if (!current(state) || state.busy || !state.editor || !state.plan) return;
    var editor = state.editor;
    var edit = { id: editor.id, body: editor.body };
    if (editor.add) edit.add = true;
    var run = ++state.run;
    var controller = state.controller = new AbortController();
    state.busy = 'revising';
    editor.error = '';
    setStatus(state, state.t('aiReviewImportChecking'));
    updateActions(state);
    Promise.resolve().then(function() {
      checkCurrent(state, run);
      return window.GlReviewImport.revise(state.plan, [edit], { signal: controller.signal });
    }).then(function(plan) {
      if (!current(state) || state.run !== run) return;
      // Keep exclusions and confirmed outcomes. A fresh validation refusal
      // takes precedence over a previous retry error on an unchanged row.
      state.results.delete(editor.id);
      plan.items.forEach(function(item) {
        var previous = state.results.get(item.id);
        if (previous && (previous.status === 'failed' || previous.status === 'skipped') && item.status !== 'ready') state.results.delete(item.id);
      });
      state.plan = plan;
      state.resolveSelected = new Set(plan.items.filter(function(item) {
        return canResolve(item) && selectable(state, item) && state.resolveSelected.has(item.id);
      }).map(function(item) { return item.id; }));
      state.selected = new Set(plan.items.filter(function(item) {
        return selectable(state, item) && (state.selected.has(item.id) || editor.add && item.id === editor.id);
      }).map(function(item) { return item.id; }));
      state.input.value = JSON.stringify(plan.source, null, 2);
      state.editor = null;
      warnings(state, plan.warnings || []);
      setStatus(state, state.t('aiReviewImportChecked', [state.selected.size]));
    }).catch(function(error) {
      if (!current(state) || state.run !== run || error.name === 'AbortError') return;
      editor.error = state.t('aiReviewImportEditError') + ': ' + error.message;
      setStatus(state, editor.error, true);
    }).then(function() {
      if (!current(state) || state.run !== run) return;
      state.busy = '';
      render(state);
      if (state.editorInput) state.editorInput.focus();
    });
  }

  function invalidate(state) {
    // A write cannot be retargeted by editing the input while it is running.
    if (state.busy === 'sending') return;
    state.run++;
    if (state.controller) state.controller.abort();
    state.busy = '';
    state.editor = null;
    state.plan = null;
    state.selected.clear();
    state.resolveSelected.clear();
    state.results.clear();
    warnings(state, []);
    setStatus(state, state.t('aiReviewImportEdited'));
    render(state);
  }

  function copyPrompt(state, replies) {
    if (!current(state) || state.busy || state.editor) return;
    var formatOnly = replies === 'format';
    var label = state.t(formatOnly ? 'aiReviewImportFormat' : 'aiReviewImportPrompt');
    state.promptSummary.textContent = label;
    state.prompt.setAttribute('aria-label', label);
    var run = ++state.run, controller = state.controller = new AbortController();
    state.busy = 'prompt';
    state.prompt.value = '';
    state.promptDetails.hidden = true;
    setStatus(state, formatOnly ? '' : state.t('aiReviewImportPromptLoading'));
    updateActions(state);
    Promise.resolve().then(function() {
      checkCurrent(state, run);
      if (formatOnly) return window.GlReviewImport.getResponseFormat();
      return window.GlReviewImport[replies ? 'getReplyPrompt' : 'getPrompt'](state.context, { signal: controller.signal });
    }).then(function(text) {
      if (!current(state) || state.run !== run) return;
      state.prompt.value = text;
      state.promptDetails.hidden = false;
      state.promptDetails.open = true;
      var write;
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
        write = navigator.clipboard.writeText(text);
      } catch (error) { write = Promise.reject(error); }
      return Promise.resolve(write).then(function() {
        if (current(state) && state.run === run) setStatus(state, state.t('aiReviewCopied'));
      }, function() {
        if (!current(state) || state.run !== run) return;
        setStatus(state, state.t('aiReviewImportCopyFailed'));
        state.prompt.focus(); state.prompt.select();
      });
    }).catch(function(error) {
      if (current(state) && state.run === run && error.name !== 'AbortError') setStatus(state, state.t('aiReviewImportPromptError') + ': ' + error.message, true);
    }).then(function() {
      if (!current(state) || state.run !== run) return;
      state.busy = ''; updateActions(state);
    });
  }

  function prepare(state) {
    if (!current(state) || state.busy || state.editor || !state.input.value.trim()) return;
    var run = ++state.run;
    var controller = state.controller = new AbortController();
    state.busy = 'checking';
    state.plan = null;
    state.results.clear();
    state.selected.clear();
    state.resolveSelected.clear();
    warnings(state, []);
    setStatus(state, state.t('aiReviewImportChecking'));
    render(state);
    Promise.resolve().then(function() {
      checkCurrent(state, run);
      return window.GlReviewImport.prepare(state.context, state.input.value, { signal: controller.signal });
    }).then(function(plan) {
      if (!current(state) || state.run !== run) return;
      state.plan = plan;
      state.subject.textContent = (plan.mrTitle || state.context.projectPath + ' !' + state.context.iid) +
        (plan.headSha ? ' · ' + plan.headSha.slice(0, 12) : '');
      plan.items.forEach(function(item) { if (item.status === 'ready') state.selected.add(item.id); });
      warnings(state, plan.warnings || []);
      setStatus(state, state.t('aiReviewImportChecked', [state.selected.size]));
    }).catch(function(error) {
      if (current(state) && state.run === run && error.name !== 'AbortError') setStatus(state, state.t('aiReviewImportError') + ': ' + error.message, true);
    }).then(function() {
      if (!current(state) || state.run !== run) return;
      state.busy = '';
      render(state);
    });
  }

  function acceptResult(state, result) {
    if (!result || !state.plan.items.some(function(item) { return item.id === result.id; })) return;
    state.results.set(result.id, result);
    if (result.status !== 'failed' && result.status !== 'skipped') state.selected.delete(result.id);
  }

  function publish(state, mode) {
    if (!current(state) || state.busy || state.editor || !state.plan || !state.selected.size) return;
    var selected = state.plan.items.filter(function(item) { return state.selected.has(item.id) && selectable(state, item); }).map(function(item) { return item.id; });
    if (!selected.length) return;
    var controller = state.controller = new AbortController();
    var run = ++state.run;
    var completed = new Set();
    state.busy = 'sending';
    state.stopping = false;
    setStatus(state, state.t('aiReviewImportSending'));
    updateActions(state);
    var csrfMeta = document.querySelector('meta[name="csrf-token"]');
    var csrfToken = csrfMeta && (csrfMeta.content || csrfMeta.getAttribute('content')) || '';
    Promise.resolve().then(function() {
      checkCurrent(state, run);
      return window.GlReviewImport.publish(state.plan, selected, {
        mode: mode, signal: controller.signal, csrfToken: csrfToken,
        resolveIds: mode === 'publish' ? selected.filter(function(id) { return state.resolveSelected.has(id); }) : [],
        onProgress: function(progress) {
          if (!current(state) || state.run !== run || !progress.item) return;
          completed.add(progress.item.id);
          acceptResult(state, progress.item);
          render(state);
        }
      });
    }).then(function(result) {
      if (!current(state) || state.run !== run) return;
      (result.items || []).forEach(function(item) { completed.add(item.id); acceptResult(state, item); });
      selected.forEach(function(id) {
        if (!completed.has(id)) acceptResult(state, { id: id, status: 'unknown', message: '' });
      });
      warnings(state, (state.plan.warnings || []).concat(result.warnings || []));
      setStatus(state, state.t(state.stopping ? 'aiReviewImportStopped' : 'aiReviewImportFinished'));
    }).catch(function(error) {
      if (!current(state) || state.run !== run) return;
      // A missing response must never expose an automatic resend action. The
      // data layer reconciles uncertain delivery when the user checks again.
      selected.forEach(function(id) {
        if (!completed.has(id)) acceptResult(state, {
          id: id, status: error.beforeSend ? (error.name === 'AbortError' ? 'skipped' : 'failed') : 'unknown',
          message: error.name === 'AbortError' ? '' : error.message
        });
      });
      setStatus(state, state.t(error.name === 'AbortError' ? 'aiReviewImportStopped' : 'aiReviewImportError'), error.name !== 'AbortError');
    }).then(function() {
      if (!current(state) || state.run !== run) return;
      state.busy = '';
      state.stopping = false;
      render(state);
    });
  }

  function open(context, options) {
    if (!window.GlReviewImport || !context || context.kind !== 'merge_requests' || !samePage(context)) return;
    if (close() === false) return;
    var state = { context: context, t: options && options.t || function(key) { return key; }, previousFocus: document.activeElement,
      selected: new Set(), resolveSelected: new Set(), results: new Map(), plan: null, editor: null, manualId: 0, busy: '', run: 0 };
    active = state;
    state.overlay = element('div', 'gl-review-overlay gl-review-import-overlay');
    var dialog = state.dialog = element('section', 'gl-review-dialog gl-review-import-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'gl-review-import-title');
    var header = element('header', 'gl-review-header');
    var titleBox = element('div');
    var title = element('h2', '', state.t('aiReviewImportTitle'));
    title.id = 'gl-review-import-title';
    titleBox.appendChild(title);
    state.subject = element('p', 'gl-review-subject', context.projectPath + ' !' + context.iid);
    titleBox.appendChild(state.subject);
    header.appendChild(titleBox);
    header.appendChild(button(state, 'aiReviewClose', close));
    dialog.appendChild(header);
    state.status = element('div', 'gl-review-status');
    state.status.setAttribute('role', 'status');
    dialog.appendChild(state.status);
    state.warning = element('div', 'gl-review-warning');
    state.warning.hidden = true;
    dialog.appendChild(state.warning);
    var columns = element('div', 'gl-review-columns gl-review-import-columns');
    var inputPane = element('section', 'gl-review-output gl-review-import-input-pane');
    inputPane.appendChild(element('p', 'gl-review-muted gl-review-import-help', state.t('aiReviewImportHelp')));
    var promptActions = element('div', 'gl-review-copy-prompt-actions');
    state.copyPrompt = button(state, 'aiReviewImportCopyPrompt', function() { copyPrompt(state, false); });
    state.copyReplyPrompt = button(state, 'aiReviewImportCopyAllReplyPrompt', function() { copyPrompt(state, true); });
    state.copyFormat = button(state, 'aiReviewImportCopyFormat', function() { copyPrompt(state, 'format'); });
    promptActions.appendChild(state.copyPrompt);
    promptActions.appendChild(state.copyReplyPrompt);
    promptActions.appendChild(state.copyFormat);
    var promptShortcuts = element('details', 'gl-review-advanced');
    promptShortcuts.appendChild(element('summary', '', state.t('aiReviewAdvanced')));
    promptShortcuts.appendChild(promptActions);
    inputPane.appendChild(promptShortcuts);
    state.promptDetails = element('details', 'gl-review-prompt-details');
    state.promptDetails.hidden = true;
    state.promptSummary = element('summary', '', state.t('aiReviewImportPrompt'));
    state.promptDetails.appendChild(state.promptSummary);
    state.prompt = element('textarea', 'gl-review-prompt');
    state.prompt.readOnly = true; state.prompt.spellcheck = false;
    state.prompt.setAttribute('aria-label', state.t('aiReviewImportPrompt'));
    state.promptDetails.appendChild(state.prompt);
    inputPane.appendChild(state.promptDetails);
    var inputLabel = element('label', 'gl-review-preview-label', state.t('aiReviewImportInput'));
    inputLabel.htmlFor = 'gl-review-import-input';
    inputPane.appendChild(inputLabel);
    state.input = element('textarea', 'gl-review-preview gl-review-import-input');
    state.input.id = 'gl-review-import-input';
    state.input.spellcheck = false;
    state.input.placeholder = state.t('aiReviewImportInputHint');
    state.input.setAttribute('aria-label', state.t('aiReviewImportInput'));
    state.input.addEventListener('input', function() { invalidate(state); });
    inputPane.appendChild(state.input);
    state.validate = button(state, 'aiReviewImportValidate', function() { prepare(state); });
    inputPane.appendChild(state.validate);
    columns.appendChild(inputPane);
    var previewPane = element('section', 'gl-review-picker gl-review-import-preview-pane');
    previewPane.appendChild(element('h3', 'gl-review-import-preview-title', state.t('aiReviewImportPreview')));
    var actions = element('div', 'gl-review-tools');
    state.select = button(state, 'aiReviewImportSelectReady', function() {
      if (!state.plan || state.busy || state.editor) return;
      state.plan.items.forEach(function(item) { if (selectable(state, item)) state.selected.add(item.id); });
      updateActions(state);
    });
    state.clear = button(state, 'aiReviewClear', function() { if (!state.busy && !state.editor) { state.selected.clear(); updateActions(state); } });
    state.add = button(state, 'aiReviewImportAddComment', function() { startEditor(state); });
    actions.appendChild(state.select);
    actions.appendChild(state.clear);
    actions.appendChild(state.add);
    previewPane.appendChild(actions);
    state.count = element('div', 'gl-review-count');
    previewPane.appendChild(state.count);
    state.list = element('div', 'gl-review-list');
    previewPane.appendChild(state.list);
    columns.appendChild(previewPane);
    dialog.appendChild(columns);
    var footer = element('footer', 'gl-review-footer gl-review-import-footer');
    footer.appendChild(element('p', 'gl-review-muted gl-review-import-send-hint', state.t('aiReviewImportSendHint')));
    state.replyHint = element('p', 'gl-review-muted gl-review-import-send-hint', state.t('aiReviewImportReplyHint'));
    state.replyHint.hidden = true;
    footer.appendChild(state.replyHint);
    state.stop = button(state, 'aiReviewImportStop', function() {
      if (state.busy !== 'sending' || state.stopping) return;
      state.stopping = true;
      state.controller.abort();
      updateActions(state);
    });
    footer.appendChild(state.stop);
    state.drafts = button(state, 'aiReviewImportAddDrafts', function() { publish(state, 'draft'); });
    footer.appendChild(state.drafts);
    state.publish = button(state, 'aiReviewImportPublish', function() { publish(state, 'publish'); }, 'gl-review-primary');
    footer.appendChild(state.publish);
    dialog.appendChild(footer);
    state.overlay.appendChild(dialog);
    state.overlay.addEventListener('click', function(event) { if (event.target === state.overlay) close(); });
    state.onKeydown = function(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      if (event.key !== 'Tab') return;
      var targets = Array.from(dialog.querySelectorAll('button, input, textarea, summary, a[href]')).filter(function(el) {
        return !el.disabled && !el.hidden && !el.closest('[hidden]') && el.getClientRects().length;
      });
      if (!targets.length) return;
      var first = targets[0]; var last = targets[targets.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', state.onKeydown, true);
    document.body.appendChild(state.overlay);
    render(state);
    state.input.focus();
  }

  var closeSettingChanged = false;
  if (typeof chrome !== 'undefined' && chrome.storage) {
    if (chrome.storage.onChanged) chrome.storage.onChanged.addListener(function(changes, area) {
      if (area !== 'sync' || !changes.ai_review_confirm_close) return;
      closeSettingChanged = true;
      confirmClose = changes.ai_review_confirm_close.newValue === true;
    });
    if (chrome.storage.sync) chrome.storage.sync.get({ ai_review_confirm_close: false }, function(values) {
      if (chrome.runtime.lastError || closeSettingChanged) return;
      confirmClose = values.ai_review_confirm_close === true;
    });
  }
  window.GlReviewImportUI = { open: open, close: close };
})();
