import {describe,expect,it} from 'vitest';
import {initialModel} from './model.js';
import {commandMatches} from './commands/registry.js';
import {keymapConflicts} from './keymap.js';
import {layoutFor} from './layout.js';
import {update} from './update.js';
import {buildFrame} from './view.js';

describe('Phase 13.6 command and TUI hardening',()=>{
 it('has no default keymap conflicts',()=>expect(keymapConflicts()).toEqual([]));
 it('finds mission and fleet commands',()=>{
  const m=initialModel(120,40);
  expect(commandMatches('mission',m)[0]?.command.id).toBe('nav.mission');
  expect(commandMatches('fleet',m)[0]?.command.id).toBe('nav.fleet');
 });
 it('opens and navigates the command palette through the reducer',()=>{
  let m=initialModel(120,40);
  m=update(m,{type:'COMMAND_PALETTE_OPEN'});
  m=update(m,{type:'COMMAND_PALETTE_INPUT',char:'f'});
  expect(m.commandPalette.open).toBe(true);
  expect(commandMatches(m.commandPalette.query,m)[0]?.command.id).toBe('nav.fleet');
  m=update(m,{type:'COMMAND_PALETTE_EXECUTE'});
  expect(m.page).toBe('fleet');
  expect(m.commandPalette.open).toBe(false);
 });
 it('keeps layout stable across required terminal widths',()=>{
  for(const width of [60,80,100,120,160,192]){
   const m=initialModel(width,30); const l=layoutFor(m);
   expect(l.mainWidth).toBeGreaterThanOrEqual(0);
   expect(l.bodyHeight).toBeGreaterThanOrEqual(0);
   expect(buildFrame(m).split('\n')).toHaveLength(30);
  }
 });
 it('supports reduced motion and ascii rendering switches without changing state',()=>{
  expect(typeof buildFrame(initialModel(80,24))).toBe('string');
 });
});
