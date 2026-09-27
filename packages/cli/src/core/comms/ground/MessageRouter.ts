import type { CommsMessage,Participant } from './types.js';
import { CommsRegistry } from './CommsRegistry.js';
function topicMatches(subscription:string,topic:string){return subscription==='*'||subscription===topic||(subscription.endsWith('*')&&topic.startsWith(subscription.slice(0,-1)));}
export class MessageRouter{
 constructor(private readonly registry:CommsRegistry){}
 recipients(message:CommsMessage):Participant[]{
  if(message.recipientId){const participant=this.registry.get(message.recipientId);return participant?[participant]:[];}
  const subscriptions=this.registry.subscriptionsFor(message.topic);
  const recipients:Participant[]=[];
  for(const id of new Set(subscriptions.map(s=>s.participantId))){
   const participant=this.registry.get(id);
   if(participant?.connected&&subscriptions.some(s=>s.participantId===id&&topicMatches(s.topic,message.topic)))recipients.push(participant);
  }
  return recipients;
 }
}