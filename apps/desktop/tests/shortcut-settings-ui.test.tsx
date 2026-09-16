// Spec: docs_v2/specs/shortcut-settings.md
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act} from 'react';
import {ShortcutSettings} from '../src/desktop/adapters/inbound/react-renderer/product-shell/settings/shortcut-settings.tsx';
import {matchesShortcut} from '../src/desktop/adapters/inbound/react-renderer/support/shortcuts.ts';

test('Settings records keys, blocks conflicts, cancels, persists and resets', async()=>{
 const dom=new JSDOM('<html><body><div id="root"></div></body></html>');
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const writes:Record<string,string>={};const capture:boolean[]=[];
 Object.assign(dom.window,{tide:{uiPrefs:{},saveUiPref:(key:string,value:string)=>writes[key]=value,setShortcutRecording:(value:boolean)=>capture.push(value)}});
 const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root')!);
 const click=async(label:string)=>act(async()=>{const button=document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;assert.ok(button);button.click();});
 const key=async(key:string,code:string,metaKey=true)=>act(async()=>{window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,code,metaKey,bubbles:true,cancelable:true}));});
 try {
  await act(async()=>root.render(<ShortcutSettings/>));
  await click('Change Quick open file');await key('b','KeyB');
  assert.match(document.body.textContent!,/Already used by Toggle left rail/);assert.equal(writes['tide.shortcuts'],undefined);
  await key('Escape','Escape',false);assert.equal(capture.at(-1),false);
  await click('Change Quick open file');await key('k','KeyK');
  assert.equal(JSON.parse(writes['tide.shortcuts']).quickOpen,'Cmd+K');
  assert.ok(matchesShortcut('quickOpen',{key:'k',code:'KeyK',metaKey:true,ctrlKey:false,altKey:false,shiftKey:false}));
  assert.ok(!matchesShortcut('quickOpen',{key:'p',code:'KeyP',metaKey:true,ctrlKey:false,altKey:false,shiftKey:false}));
  await click('Reset Quick open file');assert.deepEqual(JSON.parse(writes['tide.shortcuts']),{});
  await click('Change Quick open file');await key('k','KeyK');
  await act(async()=>{[...document.querySelectorAll('button')].find(button=>button.textContent==='Reset all to defaults')!.click();});
  assert.deepEqual(JSON.parse(writes['tide.shortcuts']),{});
 } finally {await act(async()=>root.unmount());dom.window.close();}
});
