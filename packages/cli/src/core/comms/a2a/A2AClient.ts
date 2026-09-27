import type { A2AAgentCard, A2AClient as A2AClientContract, A2ATask } from './types.js';
import { A2AAgentCardSchema, A2ATaskSchema } from './schemas.js';
const endpoint=(url:string)=>url.replace(/\/$/,'');
export class DefaultA2AClient implements A2AClientContract {
 async discover(url:string):Promise<A2AAgentCard>{const response=await fetch(endpoint(url));if(!response.ok)throw new Error(`A2A discovery failed: ${response.status}`);return A2AAgentCardSchema.parse(await response.json());}
 async sendTask(url:string,task:A2ATask):Promise<A2ATask>{const response=await fetch(`${endpoint(url)}/tasks`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(task)});if(!response.ok)throw new Error(`A2A task submission failed: ${response.status}`);return A2ATaskSchema.parse(await response.json());}
 async getTask(url:string,taskId:string):Promise<A2ATask>{const response=await fetch(`${endpoint(url)}/tasks/${encodeURIComponent(taskId)}`);if(!response.ok)throw new Error(`A2A task lookup failed: ${response.status}`);return A2ATaskSchema.parse(await response.json());}
 async cancelTask(url:string,taskId:string):Promise<A2ATask>{const response=await fetch(`${endpoint(url)}/tasks/${encodeURIComponent(taskId)}`,{method:'DELETE'});if(!response.ok)throw new Error(`A2A task cancellation failed: ${response.status}`);return A2ATaskSchema.parse(await response.json());}
}