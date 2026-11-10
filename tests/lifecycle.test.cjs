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

test('cancelled debounce timers and completed polling intervals leave no owned resources', () => {
 const env = harness.environment();
 const clearedTimeouts = [], clearedIntervals = [];
 const clearTimeout = env.context.clearTimeout, clearInterval = env.context.clearInterval;
 env.context.clearTimeout = id => {clearedTimeouts.push(id); clearTimeout(id);};
 env.context.clearInterval = id => {clearedIntervals.push(id); clearInterval(id);};
 vm.runInContext(bundleForTest('src/shared/lib/lifecycle/index.ts', {globalName: 'Lifecycle'}), env.context);
 const scope = env.context.Lifecycle.createLifecycle();
 for (let i = 0; i < 1000; i++) {
  scope.cancelTimeout(scope.timeout(() => assert.fail('cancelled timeout ran'), 100));
  scope.cancelInterval(scope.interval(() => assert.fail('cancelled poll ran'), 100));
 }
 const cancellations = [clearedTimeouts.length, clearedIntervals.length];
 scope.dispose();
 assert.deepEqual([clearedTimeouts.length, clearedIntervals.length], cancellations, 'disposal must not retain or cancel already released handles');
});

test('closed child scopes unregister from their parent and inherit parent disposal', () => {
 const env = harness.environment();
 const registries = [];
 env.context.Set = class extends Set {constructor(...args) {super(...args); registries.push(this);}};
 vm.runInContext(bundleForTest('src/shared/lib/lifecycle/index.ts', {globalName: 'Lifecycle'}), env.context);
 const {createLifecycle, createChildLifecycle} = env.context.Lifecycle;
 const parent = createLifecycle();
 for (let i = 0; i < 100; i++) createChildLifecycle(parent).dispose();
 assert.equal(registries.reduce((sum, set) => sum + set.size, 0), 0, 'closed dialogs must not remain in parent cleanup registries');
 const child = createChildLifecycle(parent);
 let calls = 0;
 child.onCleanup(() => calls++);
 parent.dispose(); parent.dispose(); child.dispose();
 assert.equal(calls, 1);
 assert.equal(child.signal.aborted, true);
 assert.equal(createChildLifecycle(parent).disposed, true);
});

test('one-shot callbacks release after completion and are cancelled with their scope', () => {
 const env = harness.environment();
 const registries = [];
 env.context.Set = class extends Set {constructor(...args) {super(...args); registries.push(this);}};
 vm.runInContext(bundleForTest('src/shared/lib/lifecycle/index.ts', {globalName: 'Lifecycle'}), env.context);
 const scope = env.context.Lifecycle.createLifecycle();
 let deliveries = 0;
 const reply = scope.once(value => {deliveries++; return value;});
 assert.equal(reply(42), 42);
 assert.equal(reply(43), undefined);
 assert.equal(registries.reduce((sum, set) => sum + set.size, 0), 0);
 const stale = scope.once(() => deliveries++);
 scope.dispose(); stale();
 assert.equal(deliveries, 1);
 assert.equal(scope.once(() => deliveries++)(), undefined);
});
