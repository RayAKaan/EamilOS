export type FleetAgentStatus='idle'|'starting'|'running'|'paused'|'blocked'|'error'|'disconnected'|'ready';
export type FleetDeviceStatus='connected'|'connecting'|'disconnected'|'offline'|'error';

export interface FleetAgent {
  id:string; name:string; status:FleetAgentStatus;
  currentTaskId?:string; currentExecutionId?:string; deviceId?:string;
  capabilities:string[]; connectedAt?:number; lastSeenAt?:number;
  health:'healthy'|'degraded'|'unhealthy'|'unknown'; utilization?:number;
}
export interface FleetDevice {
  id:string; name:string; status:FleetDeviceStatus;
  agentIds:string[]; taskIds:string[]; capabilities:string[];
  health:'healthy'|'degraded'|'unhealthy'|'unknown'; lastSeenAt?:number;
}
export interface FleetState {
  agents:FleetAgent[];
  devices:FleetDevice[];
  selectedAgentId?:string;
  selectedDeviceId?:string;
  lastEventAt?:number;
}
export function initialFleetState():FleetState{return{agents:[],devices:[]};}
