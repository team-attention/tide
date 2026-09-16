import { useSyncExternalStore } from 'react';
import { parseShortcutOverrides, SHORTCUTS_STORAGE_KEY, shortcutMatches, type ShortcutKeyEvent, type ShortcutOverrides } from '../../../../../shared/shortcuts.ts';
import { getStoredPref, setStoredPref } from './ui-prefs-store.ts';
let owner: Window | undefined;
let overrides: ShortcutOverrides = {};
let recording = false;
const listeners = new Set<()=>void>();
const notify = () => listeners.forEach(listener=>listener());
export function currentShortcuts():ShortcutOverrides {
 if(typeof window!=='undefined' && owner!==window){
  owner=window;overrides=parseShortcutOverrides(getStoredPref(SHORTCUTS_STORAGE_KEY));
  window.tide?.onShortcutsChanged?.(raw=>{overrides=parseShortcutOverrides(raw);notify();});
 }
 return overrides;
}
export function saveShortcuts(next:ShortcutOverrides):void { currentShortcuts();overrides=next;setStoredPref(SHORTCUTS_STORAGE_KEY,JSON.stringify(next));notify(); }
export function useShortcuts():ShortcutOverrides {return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},currentShortcuts,()=>overrides);}
export function matchesShortcut(id:string,event:ShortcutKeyEvent):boolean {return !recording && shortcutMatches(id,event,currentShortcuts());}
export function setShortcutRecording(active:boolean):void {recording=active;window.tide?.setShortcutRecording?.(active);}
