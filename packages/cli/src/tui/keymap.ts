export type KeyContext='global'|'mission'|'execution'|'tasks'|'artifacts'|'sessions'|'github'|'fleet'|'graph'|'loop'|'decisions'|'approvals'|'chat'|'logs';
export interface KeyBinding{key:string;command:string;contexts:KeyContext[];description:string;}
export const DEFAULT_KEYMAP:readonly KeyBinding[]=[
 {key:'ctrl+p',command:'palette.open',contexts:['global'],description:'Command palette'},
 {key:'?',command:'help.open',contexts:['global'],description:'Keyboard help'},
 {key:'esc',command:'navigation.back',contexts:['global'],description:'Back / close overlay'},
 {key:'ctrl+c',command:'system.cancel',contexts:['global'],description:'Cancel / exit'},
 {key:'m',command:'nav.mission',contexts:['global'],description:'Mission'},
 {key:'x',command:'nav.execution',contexts:['global'],description:'Live execution'},
 {key:'t',command:'nav.tasks',contexts:['global'],description:'Tasks'},
 {key:'a',command:'nav.artifacts',contexts:['global'],description:'Artifacts'},
 {key:'s',command:'nav.sessions',contexts:['global'],description:'Sessions'},
 {key:'g',command:'nav.github',contexts:['global'],description:'GitHub'},
 {key:'f',command:'nav.fleet',contexts:['global'],description:'Fleet'},
 {key:'r',command:'nav.graph',contexts:['global'],description:'Graph'},
 {key:'l',command:'nav.loop',contexts:['global'],description:'Loop'},
 {key:'d',command:'nav.decisions',contexts:['global'],description:'Decisions'},
 {key:'p',command:'nav.approvals',contexts:['global'],description:'Approvals'},
 {key:'c',command:'nav.chat',contexts:['global'],description:'Chat'},
 {key:'z',command:'nav.logs',contexts:['global'],description:'Logs'},
];
export function bindingsFor(context:KeyContext):KeyBinding[]{return DEFAULT_KEYMAP.filter(b=>b.contexts.includes('global')||b.contexts.includes(context));}
export function findBinding(key:string,context:KeyContext):KeyBinding|undefined{return bindingsFor(context).find(b=>b.key===key);}
export function keymapConflicts(bindings:readonly KeyBinding[]=DEFAULT_KEYMAP):string[]{const seen=new Map<string,string>();const conflicts:string[]=[];for(const b of bindings){const k=b.key.toLowerCase();const prior=seen.get(k);if(prior&&prior!==b.command)conflicts.push(k+': '+prior+' vs '+b.command);else seen.set(k,b.command);}return conflicts;}
