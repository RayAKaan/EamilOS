import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { A2ATaskStore } from './A2ATaskStore.js';
import { A2ATaskStateSchema, type A2AAgentCard, type A2ATask } from './types.js';
import { A2AAgentCardSchema } from './schemas.js';

export class A2AServer {
  private server: Server | null = null;
  readonly tasks: A2ATaskStore;
  constructor(private readonly card: A2AAgentCard, tasks?: A2ATaskStore) { this.tasks = tasks ?? new A2ATaskStore(); }

  async start(host='127.0.0.1', port=0): Promise<{ host:string; port:number }> {
    if (this.server) throw new Error('A2A server already started');
    this.server = createServer((req,res)=>this.handle(req,res));
    await new Promise<void>((resolve,reject)=>{
      this.server!.once('error',reject);
      this.server!.listen(port,host,()=>resolve());
    });
    const address=this.server.address();
    if (!address || typeof address==='string') throw new Error('A2A server address unavailable');
    return { host, port: address.port };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server=this.server;
    this.server=null;
    await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }

  private async handle(req:IncomingMessage,res:ServerResponse) {
    res.setHeader('content-type','application/json');
    try {
      const path=req.url?.split('?')[0] ?? '/';
      if (req.method==='GET' && path==='/') return this.send(res,200,A2AAgentCardSchema.parse(this.card));
      if (req.method==='GET' && path==='/agent-card') return this.send(res,200,A2AAgentCardSchema.parse(this.card));
      if (req.method==='POST' && path==='/tasks') {
        const body=await this.body(req);
        const input=JSON.parse(body) as Partial<A2ATask>;
        const now=new Date().toISOString();
        const task:A2ATask={
          id:input.id ?? randomUUID(), contextId:input.contextId ?? randomUUID(),
          state:'submitted', messages:input.messages ?? [], artifacts:input.artifacts ?? [],
          metadata:input.metadata ?? {}, createdAt:now, updatedAt:now,
        };
        this.tasks.put(task);
        return this.send(res,202,task);
      }
      const match=path.match(/^\/tasks\/([^/]+)$/);
      if (match) {
        const task=this.tasks.get(decodeURIComponent(match[1]!));
        if (!task) return this.send(res,404,{error:'task_not_found'});
        if (req.method==='GET') return this.send(res,200,task);
        if (req.method==='DELETE') return this.send(res,200,this.tasks.update(task.id,{state:'canceled'}));
      }
      return this.send(res,404,{error:'not_found'});
    } catch(error) {
      return this.send(res,400,{error:error instanceof Error?error.message:String(error)});
    }
  }

  private async body(req:IncomingMessage):Promise<string> {
    const chunks:Buffer[]=[];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }
  private send(res:ServerResponse,status:number,value:unknown) { res.statusCode=status; res.end(JSON.stringify(value)); }
}
