// App-owned commands shared by native menus, renderer routing and Settings.
export const SHORTCUTS_STORAGE_KEY = 'tide.shortcuts';
export interface ShortcutDefinition { id: string; label: string; group: string; defaults: string[]; }
const row = (id: string, label: string, group: string, ...defaults: string[]): ShortcutDefinition => ({id,label,group,defaults});
export const SHORTCUTS: ShortcutDefinition[] = [
 row('leftRail','Toggle left rail','App','CmdOrCtrl+B'), row('fileTree','Toggle file tree','App','CmdOrCtrl+E'),
 row('workbench','Toggle workbench','App','CmdOrCtrl+J'), row('close','Close pane or thread','App','CmdOrCtrl+W'),
 row('closeWindow','Close window','App','CmdOrCtrl+Shift+W'), row('fullscreen','Toggle fullscreen','App','Ctrl+Cmd+F'),
 row('minimize','Minimize window','App','CmdOrCtrl+M'), row('quit','Quit Tide','App','CmdOrCtrl+Q'),
 row('zoomIn','Zoom in','App','CmdOrCtrl+Plus','CmdOrCtrl+='), row('zoomOut','Zoom out','App','CmdOrCtrl+-'), row('zoomReset','Actual size','App','CmdOrCtrl+0'),
 row('reload','Reload app','App','CmdOrCtrl+R'), row('forceReload','Force reload app','App','CmdOrCtrl+Shift+R'), row('devTools','Developer tools','App','Alt+CmdOrCtrl+I'),
 row('quickOpen','Quick open file','Search','CmdOrCtrl+P'), row('contentSearch','Search file contents','Search','CmdOrCtrl+Shift+F'),
 row('find','Find in pane','Search','CmdOrCtrl+F'), row('findNext','Next match','Search','CmdOrCtrl+G'), row('findPrevious','Previous match','Search','CmdOrCtrl+Shift+G'),
 row('save','Save file','Editor','CmdOrCtrl+S'),
 row('undo','Undo','Editing','CmdOrCtrl+Z'), row('redo','Redo','Editing','CmdOrCtrl+Shift+Z'), row('cut','Cut','Editing','CmdOrCtrl+X'),
 row('copy','Copy','Editing','CmdOrCtrl+C'), row('paste','Paste','Editing','CmdOrCtrl+V'), row('pastePlain','Paste and match style','Editing','CmdOrCtrl+Shift+Alt+V'), row('selectAll','Select all','Editing','CmdOrCtrl+A'),
 row('send','Send message','Agent Chat','Enter'), row('interrupt','Stop agent turn','Agent Chat','Escape'), row('answer','Confirm prompt answer','Agent Chat','CmdOrCtrl+Enter'),
 ...Array.from({length:9},(_,i)=>row(`answer${i+1}`,`Choose prompt option ${i+1}`,'Agent Chat',`CmdOrCtrl+${i+1}`)),
 row('nextThread','Next live thread','Threads','Alt+Tab'), row('previousThread','Previous live thread','Threads','Alt+Shift+Tab'),
 ...Array.from({length:9},(_,i)=>row(`thread${i+1}`,`Go to thread ${i+1}`,'Threads',`Alt+${i+1}`)),
];
export type ShortcutOverrides = Record<string,string>;
export interface ShortcutKeyEvent {key:string; code?:string; metaKey:boolean; ctrlKey:boolean; altKey:boolean; shiftKey:boolean; isComposing?:boolean; keyCode?:number;}
const modifiers = ['CmdOrCtrl','Cmd','Ctrl','Alt','Shift'];
const namedKeys = ['Enter','Escape','Tab','Space','Backspace','Delete','Up','Down','Left','Right','Home','End','PageUp','PageDown','Plus'];
export function validShortcut(value: string): boolean {
 const parts=value.split('+'); const key=parts.pop() ?? '';
 return (key.length===1 || namedKeys.includes(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key)) && parts.every(p=>modifiers.includes(p)) && new Set(parts).size===parts.length;
}
export function parseShortcutOverrides(raw: string | undefined | null): ShortcutOverrides {
 try {const data=JSON.parse(raw ?? '{}'); if(!data || typeof data!=='object' || Array.isArray(data))return {}; return Object.fromEntries(Object.entries(data).filter(([id,value])=>SHORTCUTS.some(s=>s.id===id) && typeof value==='string' && validShortcut(value))) as ShortcutOverrides;}catch{return {};}
}
export function shortcutKeys(id:string, overrides:ShortcutOverrides):string[] {return overrides[id] ? [overrides[id]] : SHORTCUTS.find(s=>s.id===id)?.defaults ?? [];}
function keyFor(event:ShortcutKeyEvent):string {
 if(event.code?.startsWith('Key'))return event.code.slice(3).toUpperCase();
 if(event.code?.startsWith('Digit'))return event.code.slice(5);
 const key=event.key.replace(/^Arrow/,''); return key===' ' ? 'Space' : key==='+' ? 'Plus' : key.length===1 ? key.toUpperCase() : key;
}
export function recordShortcut(event:ShortcutKeyEvent):string|null {
 if(event.isComposing || event.keyCode===229 || ['Meta','Control','Alt','Shift','Dead','Process','Unidentified'].includes(event.key))return null;
 const value=[event.metaKey?'Cmd':'',event.ctrlKey?'Ctrl':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',keyFor(event)].filter(Boolean).join('+');
 return validShortcut(value) ? value : null;
}
export function shortcutMatches(id:string,event:ShortcutKeyEvent,overrides:ShortcutOverrides):boolean {
 if(event.isComposing || event.keyCode===229)return false;
 return shortcutKeys(id,overrides).some(value=>{
  const parts=value.split('+');const key=parts.pop();const mod=parts.includes('CmdOrCtrl');
  return key?.toUpperCase()===keyFor(event).toUpperCase() && (mod ? (event.metaKey || event.ctrlKey) : event.metaKey===parts.includes('Cmd') && event.ctrlKey===parts.includes('Ctrl')) && event.altKey===parts.includes('Alt') && event.shiftKey===parts.includes('Shift');
 });
}
export function shortcutConflict(id:string,value:string,overrides:ShortcutOverrides,isMac:boolean):ShortcutDefinition|undefined {
 const normalize=(s:string)=>s.replace('CmdOrCtrl',isMac?'Cmd':'Ctrl').split('+').map(s=>s.toUpperCase()).sort().join('+');
 return SHORTCUTS.find(s=>s.id!==id && shortcutKeys(s.id,overrides).some(key=>normalize(key)===normalize(value)));
}
export function shortcutLabel(value:string,isMac=true):string {return value.replaceAll('CmdOrCtrl',isMac?'⌘':'Ctrl').replaceAll('Cmd','⌘').replaceAll('Ctrl','⌃').replaceAll('Alt','⌥').replaceAll('Shift','⇧').replaceAll('Plus','+');}

// Chromium/CodeMirror retain built-in edit accelerators after a native menu
// rebind. Consume those old accelerators unless another current command owns it.
export function replacedEditingShortcut(event: ShortcutKeyEvent, overrides: ShortcutOverrides): boolean {
 return SHORTCUTS.some(row=>row.group==='Editing' && overrides[row.id] && shortcutMatches(row.id,event,{}))
  && !SHORTCUTS.some(row=>shortcutMatches(row.id,event,overrides));
}
