import type {AppModel} from '../model.js';
import {commandMatches} from './registry.js';
export function matchCommands(model:AppModel,query:string){return commandMatches(query,model);}
