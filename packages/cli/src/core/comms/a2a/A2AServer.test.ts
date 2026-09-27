import { describe, expect, it } from 'vitest';
import { A2ARegistry } from './A2ARegistry.js';
import { A2AServer } from './A2AServer.js';
import { DefaultA2AClient } from './A2AClient.js';

describe('A2A', () => {
  it('discovers an agent and submits/reads/cancels a task', async () => {
    const card={name:'test-agent',description:'test',version:'1.0.0',capabilities:{streaming:false,pushNotifications:false},skills:[]};
    const server=new A2AServer(card);
    const address=await server.start('127.0.0.1',0);
    const url=`http://${address.host}:${address.port}`;
    const client=new DefaultA2AClient();
    expect((await client.discover(url)).name).toBe('test-agent');
    const task=await client.sendTask(url,{id:'t1',contextId:'c1',state:'submitted',messages:[],artifacts:[],metadata:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    expect(task.state).toBe('submitted');
    expect((await client.getTask(url,'t1')).id).toBe('t1');
    expect((await client.cancelTask(url,'t1')).state).toBe('canceled');
    await server.stop();
  });
});
