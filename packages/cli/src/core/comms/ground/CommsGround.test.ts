import { describe, expect, it } from 'vitest';
import { CommsGround } from './CommsGround.js';
import { InMemoryTransport } from './InMemoryTransport.js';

describe('CommsGround', () => {
  it('routes a message and deduplicates delivery', async () => {
    const ground=new CommsGround({sharedKey:'test-key'});
    const transport=new InMemoryTransport('b');
    ground.registerParticipant({id:'a',name:'A',role:'agent',capabilities:[],authenticated:true,connected:true,lastSeen:Date.now()});
    ground.registerParticipant({id:'b',name:'B',role:'agent',capabilities:[],authenticated:true,connected:true,lastSeen:Date.now()});
    ground.registerParticipant({id:'b',name:'B',role:'agent',capabilities:[],authenticated:true,connected:true,lastSeen:Date.now()},transport);
    ground.subscribe('b','task.*');
    const message=await ground.publish({conversationId:'c',senderId:'a',senderRole:'agent',topic:'task.created',kind:'EVENT',delivery:'AT_LEAST_ONCE',payload:{taskId:'t'}});
    expect(transport.received).toHaveLength(1);
    expect(message.signature).toBeDefined();
    const receipt=await ground.receive(message,'b');
    expect(receipt.duplicate).toBe(true);
  });
});
