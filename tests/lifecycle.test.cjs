'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const harness = require('./helpers/extension.cjs');
const {bundleForTest} = require('./helpers/runtime.cjs');

test('route disposal aborts reads and releases timers, observers and listeners exactly once', async () => {
 const env = harness.environment();
 let connected = 0, deliveries = 0, cleanup = 0;
 env.context.MutationObserver = class {
  observe() {connected++;} disconnect() {if (connected) connected--;} takeRecords() {return [];}
 };
 vm.runInContext(bundleForTest('src/shared/lib/lifecycle/index.ts', {globalName: 'Lifecycle'}), env.context);
 const scope = env.context.Lifecycle.createLifecycle();
 const target = new EventTarget();
 scope.listen(target, 'click', () => deliveries++);
 scope.timeout(() => deliveries++, 1);
 scope.interval(() => deliveries++, 1);
 scope.observer(() => deliveries++).observe({}, {});
 const staleCallback = scope.guard(() => deliveries++);
 scope.onCleanup(() => cleanup++);
 target.dispatchEvent(new Event('click'));
 assert.equal(deliveries, 1);
 scope.dispose(); scope.dispose();
 target.dispatchEvent(new Event('click')); staleCallback();
 assert.equal(scope.signal.aborted, true);
 assert.equal(connected, 0); assert.equal(cleanup, 1);
 assert.equal(await env.clock.next(), false);
 assert.equal(deliveries, 1);
 const lateObserver = scope.observer(() => deliveries++);
 lateObserver.observe({}, {});
 assert.equal(connected, 0, 'late callbacks must not reconnect disposed observers');
});
