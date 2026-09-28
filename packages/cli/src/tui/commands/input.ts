import type {AppModel} from '../model.js';
import {commandMatches} from './registry.js';
export function executeSlashCommand(model:AppModel,input:string){
 const query=input.trim().replace(/^\/+/, '');
 const matches=commandMatches(query,model);
 return matches[0]?.command.execute({model,query})??null;
}
export function isSlashCommand(input:string):boolean{return /^\s*\//.test(input);}
export function isShellEscape(input:string):boolean{return /^\s*!/.test(input);}
