import type {AppModel, Page} from '../model.js';

export type CommandCategory='navigation'|'mission'|'execution'|'fleet'|'graph'|'loop'|'decision'|'approval'|'session'|'system';
export interface CommandContext{model:AppModel;query:string;}
export interface CommandDefinition{
 id:string; label:string; description:string; category:CommandCategory;
 keywords?:string[];
 shortcut?:string;
 available?:(ctx:CommandContext)=>boolean;
 execute:(ctx:CommandContext)=>CommandEffect;
}
export type CommandEffect=
 | {type:'page';page:Page}
 | {type:'message';text:string}
 | {type:'palette-close'}
 | {type:'noop'};
export interface CommandMatch{command:CommandDefinition;score:number;}
export interface CommandPaletteState{open:boolean;query:string;selected:number;}
export const initialCommandPalette=():CommandPaletteState=>({open:false,query:'',selected:0});
