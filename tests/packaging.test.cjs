'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var os = require('node:os');
var execFileSync = require('node:child_process').execFileSync;
var root = require('./helpers/extension.cjs').root;

['pack.sh', 'Chrome Web Store workflow'].forEach(function(builder) {
  test(builder + ' includes extension resources and excludes test/development files', function() {
    // Build in an isolated fixture, never next to the user's existing archives.
    var staging = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlab-actions-package-'));
    try {
      var manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
      var required = ['manifest.json', 'background.js', 'content.js', 'content_proxy.js', 'review-workflow.js', 'review-export.js', 'review-import.js', 'review-import-ui.js', 'review-copy.js', 'content.css', 'popup.html', 'popup.js', 'welcome.html', 'welcome.js'];
      Object.keys(manifest.icons).forEach(function(size) { required.push(manifest.icons[size]); });
      ['en', 'ru', 'de', 'fr', 'es', 'ja', 'zh_CN'].forEach(function(locale) { required.push('_locales/' + locale + '/messages.json'); });
      required.concat(['pack.sh', 'package.json']).forEach(function(file) {
        var destination = path.join(staging, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(root, file), destination);
      });
      ['tests/example.test.cjs', 'tests/helpers/mock.cjs', 'node_modules/mock/index.js', '.git/config', '.github/workflows/tests.yml', 'docs/index.html', 'promo/example.txt', 'package-lock.json', 'CLAUDE.md', 'ROADMAP.md'].forEach(function(file) {
        var destination = path.join(staging, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, 'Must not ship');
      });

      var archive;
      if (builder === 'pack.sh') {
        execFileSync('bash', [path.join(staging, 'pack.sh')], { cwd: staging, stdio: 'pipe' });
        archive = 'gitlab-mr-actions-v' + manifest.version + '.zip';
      } else {
        // Execute only the checked-in local "Build zip" step. Never run the
        // credential/upload/publish steps or contact the Chrome Web Store.
        var workflow = fs.readFileSync(path.join(root, '.github/workflows/chrome-web-store.yml'), 'utf8');
        var build = workflow.match(/      - name: Build zip\n        run: \|\n([\s\S]*?)(?=\n      - name:)/);
        assert.ok(build, 'Build zip step must be found');
        var command = build[1].split('\n').map(function(line) { return line.slice(10); }).join('\n');
        execFileSync('bash', ['-c', command], { cwd: staging, stdio: 'pipe' });
        archive = 'extension.zip';
      }
      var entries = execFileSync('unzip', ['-Z', '-1', path.join(staging, archive)], { encoding: 'utf8' }).trim().split('\n');
      required.forEach(function(file) { assert.ok(entries.includes(file), 'Missing packaged resource: ' + file); });
      entries.forEach(function(file) {
        assert.equal(/^(tests\/|node_modules\/|\.|docs\/|promo\/|package(?:-lock)?\.json$|pack\.sh$|CLAUDE\.md$|ROADMAP\.md$)/.test(file), false, 'Unexpected packaged file: ' + file);
      });
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });
});
