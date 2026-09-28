import type {AppModel,Page} from '../model.js';
import type {CommandDefinition,CommandContext,CommandMatch} from './types.js';

const page=(id:string,label:string,page:Page,shortcut:string,category:'navigation'|'system'='navigation'):CommandDefinition=>({
 id,label,shortcut,category,description:'Open '+label.toLowerCase(),execute:()=>({type:'page',page})
});
export const COMMANDS:readonly CommandDefinition[]=[
 page('nav.mission','Mission','mission','M'),
 page('nav.execution','Live Execution','execution','X'),
 page('nav.tasks','Tasks','tasks','T'),
 page('nav.artifacts','Artifacts','artifacts','A'),
 page('nav.sessions','Sessions','sessions','S'),
 page('nav.github','GitHub','github','G'),
 page('nav.fleet','Fleet','fleet','F'),
 page('nav.graph','Graph','graph','R'),
 page('nav.loop','Loop','loop','L'),
 page('nav.decisions','Decisions','decisions','D'),
 page('nav.approvals','Approvals','approvals','P'),
 page('nav.chat','Chat','chat','C'),
 page('nav.logs','Logs','logs','Z'),
 {id:'mission.start',label:'Start Mission',description:'Start a mission from the prompt',category:'mission',keywords:['run','execute'],execute:()=>({type:'message',text:'Enter a mission objective in the prompt, then press Enter.'})},
 {id:'execution.follow',label:'Follow Live Execution',description:'Return to the live execution stream',category:'execution',keywords:['events','stream'],execute:()=>({type:'page',page:'execution'})},
 {id:'system.help',label:'Keyboard Help',description:'Show keyboard shortcuts and command usage',category:'system',shortcut:'?',execute:()=>({type:'message',text:'Ctrl+P commands · / command input · ? help · Esc back'})},
];
export function commandMatches(query:string,model:AppModel):CommandMatch[]{
 const q=query.trim().toLowerCase();
 return COMMANDS.filter(c=>!c.available||c.available({model,query})).map(c=>{
   if(!q)return{command:c,score:0};
   const hay=(c.label+' '+c.id+' '+c.description+' '+(c.keywords??[]).join(' ')).toLowerCase();
   if(hay===q)return{command:c,score:100};
   if(hay.startsWith(q))return{command:c,score:80};
   if(hay.includes(q))return{command:c,score:60};
   const parts=q.split(/\s+/).filter(Boolean); const score=parts.every(p=>hay.includes(p))?40:0;
   return{command:c,score};
 }).filter(x=>x.score>0||!q).sort((a,b)=>b.score-a.score||a.command.label.localeCompare(b.command.label));
}
export function commandContext(model:AppModel,query:string):CommandContext{return{model,query};}
