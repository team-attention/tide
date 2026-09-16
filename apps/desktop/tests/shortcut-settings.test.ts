// Spec: docs_v2/specs/shortcut-settings.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCUTS, shortcutMatches, shortcutConflict, parseShortcutOverrides, shortcutKeys, recordShortcut } from '../src/shared/shortcuts.ts';
const event = (key: string, more = {}) => ({key, code: '', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...more});
test('rebinding removes defaults, persists and reset restores all aliases', () => {
 const overrides = parseShortcutOverrides(JSON.stringify({quickOpen:'CmdOrCtrl+K'}));
 assert.ok(shortcutMatches('quickOpen', event('k'), overrides));
 assert.ok(!shortcutMatches('quickOpen', event('p'), overrides));
 delete overrides.quickOpen;
 assert.ok(shortcutMatches('quickOpen', event('p'), overrides));
 assert.deepEqual(shortcutKeys('zoomIn', {}), ['CmdOrCtrl+Plus','CmdOrCtrl+=']);
});
test('recording normalizes physical keys and ignores composition and modifier-only input', () => {
 assert.equal(recordShortcut(event('ㅏ', {code:'KeyK'})), 'Cmd+K');
 assert.equal(recordShortcut(event('Meta')), null);
 assert.equal(recordShortcut(event('k', {isComposing:true})), null);
 assert.ok(!shortcutMatches('quickOpen', event('p', {isComposing:true}), {}));
 assert.ok(!shortcutMatches('quickOpen', event('p', {altKey:true}), {}));
});
test('conflicts name the existing action and invalid persisted entries are ignored', () => {
 assert.equal(shortcutConflict('quickOpen','Cmd+B',{} ,true)?.id, 'leftRail');
 assert.equal(shortcutConflict('quickOpen','Cmd+P',{},true), undefined);
 assert.deepEqual(parseShortcutOverrides('{"unknown":"Cmd+K","quickOpen":3,"zoomIn":"bogus"}'),{});
 assert.equal(new Set(SHORTCUTS.map(s=>s.id)).size, SHORTCUTS.length);
});

test('rebound editing commands cannot fall back to built-in editor keys', async()=>{
 const {replacedEditingShortcut}=await import('../src/shared/shortcuts.ts');
 assert.ok(replacedEditingShortcut(event('c'),{copy:'Cmd+Shift+C'}));
 assert.ok(!replacedEditingShortcut(event('c'),{copy:'Cmd+Shift+C',quickOpen:'Cmd+C'}));
});
