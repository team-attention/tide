import { useEffect, useState } from 'react';
import { styled } from 'styled-components';
import { SHORTCUTS, recordShortcut, shortcutConflict, shortcutKeys, shortcutLabel } from '../../../../../../shared/shortcuts.ts';
import { saveShortcuts, setShortcutRecording, useShortcuts } from '../../support/shortcuts.ts';

export function ShortcutSettings() {
 const overrides=useShortcuts(); const [query,setQuery]=useState('');const [recording,setRecording]=useState<string|null>(null); const [error,setError]=useState('');
 const isMac=typeof navigator==='undefined'||/Mac/i.test(navigator.platform);
 useEffect(()=>{
  if(!recording)return;
  setShortcutRecording(true);
  const capture=(event:KeyboardEvent)=>{
   event.preventDefault();event.stopImmediatePropagation();
   if(event.key==='Escape'){setRecording(null);setError('');return;}
   const value=recordShortcut(event);if(!value)return;
   if(!event.metaKey&&!event.ctrlKey&&!event.altKey&&!/^F\d+$/.test(event.key)&&!(recording==='send' && event.key==='Enter')) {setError('Include Command, Control or Option to keep typing available.');return;}
   const conflict=shortcutConflict(recording,value,overrides,isMac);
   if(conflict){setError(`Already used by ${conflict.label}. Choose another key.`);return;}
   saveShortcuts({...overrides,[recording]:value});setRecording(null);setError('');
  };
  const cancel=()=>setRecording(null);
  window.addEventListener('keydown',capture,true);window.addEventListener('blur',cancel);
  return()=>{window.removeEventListener('keydown',capture,true);window.removeEventListener('blur',cancel);setShortcutRecording(false);};
 },[recording,overrides,isMac]);
 const reset=(id:string)=>{
  const next={...overrides};delete next[id];
  const conflict=shortcutKeys(id,{}).map(key=>shortcutConflict(id,key,next,isMac)).find(Boolean);
  if(conflict){setError(`Default key is used by ${conflict.label}. Reset that shortcut first, or reset all.`);return;}
  saveShortcuts(next);setError('');setRecording(null);
 };
 const rows=SHORTCUTS.filter(row=>`${row.label} ${row.group} ${shortcutKeys(row.id,overrides).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
 return <Section aria-label="Keyboard shortcuts">
  <Heading><h3>Keyboard shortcuts</h3><button type="button" disabled={!Object.keys(overrides).length} onClick={()=>{saveShortcuts({});setRecording(null);setError('');}}>Reset all to defaults</button></Heading>
  <Search aria-label="Search shortcuts" placeholder="Search shortcuts…" value={query} onChange={event=>setQuery(event.target.value)}/>
  <Status role="status">{error || (recording?'Press a key combination. Escape cancels.':`${rows.length} shortcuts · Select a key to change it`)}</Status>
  <List>{rows.map(row=><Row key={row.id}>
   <Label><span>{row.label}</span><small>{row.group}</small></Label>
   <KeyButton type="button" aria-label={`Change ${row.label}`} aria-pressed={recording===row.id} onClick={()=>{setRecording(row.id);setError('');}}>{recording===row.id?'Press keys…':shortcutKeys(row.id,overrides).map(key=>shortcutLabel(key,isMac)).join(' / ')}</KeyButton>
   <Reset type="button" disabled={!overrides[row.id]} aria-label={`Reset ${row.label}`} onClick={()=>reset(row.id)}>Reset</Reset>
  </Row>)}{!rows.length&&<Status>No shortcuts match “{query}”.</Status>}</List>
  <Note>Text navigation, Escape to dismiss, and shortcuts inside agent CLIs or websites follow their own controls.</Note>
 </Section>;
}
const Section=styled.section`border-top:1px solid var(--tide-line);padding-top:20px;margin-top:20px;`;
const Heading=styled.div`display:flex;align-items:center;justify-content:space-between;gap:12px;h3{font-size:14px;margin:0;}button{font:inherit;color:var(--tide-text);background:transparent;border:1px solid var(--tide-line);border-radius:6px;padding:6px 8px;cursor:pointer;}button:disabled{opacity:.4;cursor:default;}`;
const Search=styled.input`box-sizing:border-box;width:100%;margin-top:14px;padding:8px 10px;background:var(--tide-surface);color:var(--tide-text);border:1px solid var(--tide-line);border-radius:6px;font:inherit;`;
const Status=styled.p`font-size:12px;color:var(--tide-muted);min-height:18px;margin:8px 0;`;
const List=styled.div`max-height:340px;overflow-y:auto;`;
const Row=styled.div`display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--tide-line);`;
const Label=styled.div`flex:1;min-width:0;display:flex;flex-direction:column;font-size:13px;small{font-size:11px;color:var(--tide-muted);margin-top:2px;}`;
const KeyButton=styled.button`min-width:90px;max-width:48%;overflow-wrap:anywhere;padding:5px 8px;border:1px solid var(--tide-line);border-radius:6px;background:var(--tide-surface);color:var(--tide-text);font:12px ui-monospace,monospace;cursor:pointer;&[aria-pressed=true]{outline:2px solid var(--tide-accent);} &:focus-visible{outline:2px solid var(--tide-accent);}`;
const Reset=styled.button`border:0;background:transparent;color:var(--tide-muted);font-size:12px;font-family:inherit;cursor:pointer;&:disabled{opacity:.35;cursor:default;}`;
const Note=styled.p`font-size:11px;color:var(--tide-muted);line-height:1.5;margin-bottom:0;`;
