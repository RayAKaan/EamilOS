import type {AppModel} from './model.js';
import type {Layout} from './layout.js';
import {fit,truncate} from './terminal/text.js';
import {BOLD,DIM,FG,styled} from './terminal/ansi.js';
import {commandMatches} from './commands/registry.js';
import {onChat} from './theme.js';

export function renderCommandPalette(model:AppModel,layout:Layout):string[]{
 const width=Math.max(32,Math.min(layout.mainWidth-4,88)); const left=Math.max(0,Math.floor((layout.mainWidth-width)/2));
 const matches=commandMatches(model.commandPalette.query,model).slice(0,Math.max(1,layout.viewportHeight-8));
 const lines:string[]=[];
 const put=(s:string)=>lines.push(' '.repeat(left)+onChat(fit(s,width)));
 const title='  '+styled('COMMAND PALETTE',BOLD,FG.CYAN);
 put(title);
 put('  '+styled('> ',FG.CYAN)+styled(model.commandPalette.query||'Search commands…',model.commandPalette.query?FG.BRIGHT_WHITE:DIM,model.commandPalette.query?FG.BRIGHT_WHITE:FG.WHITE));
 put('  '+styled('─'.repeat(Math.max(0,width-4)),DIM,FG.BRIGHT_BLACK));
 if(!matches.length) put('  '+styled('No matching commands.',DIM,FG.WHITE));
 for(let i=0;i<matches.length;i++){
   const m=matches[i]!; const selected=i===model.commandPalette.selected;
   put((selected?'  '+styled('›',BOLD,FG.CYAN):'  ')+' '+(selected?styled(m.command.label,BOLD,FG.BRIGHT_WHITE):m.command.label)+'  '+styled(m.command.category,DIM,FG.WHITE));
   put('      '+truncate(m.command.description,width-10));
 }
 put('');
 put('  '+styled('↑↓',BOLD,FG.WHITE)+' navigate   '+styled('Enter',BOLD,FG.WHITE)+' run   '+styled('Esc',BOLD,FG.WHITE)+' close   '+styled('?',BOLD,FG.WHITE)+' help');
 while(lines.length<layout.viewportHeight)put('');
 const body=lines.slice(0,layout.viewportHeight);
 const top=Math.max(0,Math.floor((layout.viewportHeight-body.length)/2));
 return [...Array(top).fill(onChat(fit('',layout.mainWidth))),...body].slice(0,layout.viewportHeight);
}
