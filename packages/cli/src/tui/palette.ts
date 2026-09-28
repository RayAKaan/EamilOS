import type {AppModel} from './model.js';
import type {CommandPaletteState} from './commands/types.js';
import {initialCommandPalette} from './commands/types.js';
import {commandMatches} from './commands/registry.js';
export function paletteOpen(state:CommandPaletteState):CommandPaletteState{return{...state,open:true,query:'',selected:0};}
export function paletteClose(state:CommandPaletteState):CommandPaletteState{return{...state,open:false,query:'',selected:0};}
export function paletteInput(state:CommandPaletteState,char:string):CommandPaletteState{const next={...state,query:state.query+char,selected:0};return next;}
export function paletteBackspace(state:CommandPaletteState):CommandPaletteState{return{...state,query:state.query.slice(0,-1),selected:0};}
export function paletteMove(state:CommandPaletteState,delta:number,count:number):CommandPaletteState{return{...state,selected:Math.max(0,Math.min(Math.max(0,count-1),state.selected+delta))};}
export function paletteStateFor(model:AppModel){return model.commandPalette;}
export {initialCommandPalette};
