import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGanttDisplay } from '../../apps/web/helpers/gantt-display.ts';
test('new views show owners and legend without optional clutter', () => {
  assert.deepEqual(parseGanttDisplay('{}'), {assignee:true,priority:false,modules:false,legend:true});
});
test('explicit off survives parsing and optional fields can be enabled', () => {
  assert.deepEqual(parseGanttDisplay('{"assignee":false,"priority":true,"modules":true,"legend":false}'), {assignee:false,priority:true,modules:true,legend:false});
});
test('corrupt or wrong-shaped storage cannot override boolean defaults', () => {
  for (const raw of ['invalid','null','{"assignee":"false","priority":1}']) assert.equal(parseGanttDisplay(raw).assignee,true);
});
