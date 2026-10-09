import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationReturnPath } from '../../apps/web/helpers/notification-return.ts';
test('return preserves the originating view and query', () => assert.equal(notificationReturnPath('ai-strategy','/ai-strategy/projects/p/issues/?layout=gantt#item'),'/ai-strategy/projects/p/issues/?layout=gantt#item'));
test('direct entry, other workspaces, external paths and inbox loops fall back to home', () => {
  for (const value of [null,'https://example.com','//example.com','/other/projects/','/ai-strategy/notifications/','/ai-strategy/notifications?x=1','/ai-strategy/\\bad']) assert.equal(notificationReturnPath('ai-strategy',value),'/ai-strategy/');
});
