'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var helpers = require('./helpers/extension.cjs').proxyHelpers();

[
  { name: 'clean hunk', source: 'a\nb\nc\n', diff: '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n', expected: 'a\nB\nc\n' },
  { name: 'unrelated target edits outside the hunk', source: 'prefix\na\nb\nc\nsuffix\n', diff: '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n', expected: 'prefix\na\nB\nc\nsuffix\n' },
  { name: 'multiple hunks', source: 'a\nb\nx\nd\ne\n', diff: '@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -4,2 +4,2 @@\n d\n-e\n+E\n', expected: 'a\nB\nx\nd\nE\n' },
  { name: 'file headers', source: 'old\n', diff: '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n', expected: 'new\n' },
  { name: 'no newline on either side', source: 'old', diff: '@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n', expected: 'new' },
  { name: 'adding a final newline', source: 'old', diff: '@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n', expected: 'new\n' },
  { name: 'removing a final newline', source: 'old\n', diff: '@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n', expected: 'new' },
  { name: 'an empty file', source: '', diff: '@@ -0,0 +1 @@\n+new\n', expected: 'new\n' }
].forEach(function(example) {
  test('cherry-pick diff replay handles ' + example.name, function() {
    assert.equal(helpers.applyUnifiedDiff(example.source, example.diff), example.expected);
  });
});

[
  { name: 'missing context', source: 'other\n', diff: '@@ -1 +1 @@\n-old\n+new\n', error: /context not found/ },
  { name: 'ambiguous repeated context', source: 'old\nold\n', diff: '@@ -1 +1 @@\n-old\n+new\n', error: /Ambiguous/ },
  { name: 'empty diff', source: 'old\n', diff: '', error: /Empty diff/ },
  { name: 'binary diff', source: 'old\n', diff: 'Binary files differ', error: /Unexpected/ },
  { name: 'malformed hunk', source: 'old\n', diff: '@@ invalid @@\n-old\n+new\n', error: /Bad hunk/ },
  { name: 'insertion without context in a nonempty file', source: 'old\n', diff: '@@ -0,0 +1 @@\n+new\n', error: /Ambiguous/ },
  { name: 'unexpected missing newline', source: 'old', diff: '@@ -1 +1 @@\n-old\n+new\n', error: /newline mismatch/ },
  { name: 'unexpected existing newline', source: 'old\n', diff: '@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n', error: /newline mismatch/ }
].forEach(function(example) {
  test('cherry-pick diff replay refuses ' + example.name, function() {
    assert.throws(function() { helpers.applyUnifiedDiff(example.source, example.diff); }, example.error);
  });
});
