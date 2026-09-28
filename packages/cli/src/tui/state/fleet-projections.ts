import type { AppModel } from '../model.js';
import type { FleetAgent, FleetDevice } from '../fleet-data.js';

export const selectFleetAgents=(model:AppModel):FleetAgent[]=>model.fleet.agents;
export const selectFleetDevices=(model:AppModel):FleetDevice[]=>model.fleet.devices;
export const selectCurrentFleetAgent=(model:AppModel):FleetAgent|undefined=>model.fleet.agents.find(a=>a.id===model.fleet.selectedAgentId)??model.fleet.agents.find(a=>a.status==='running')??model.fleet.agents[0];
export const selectCurrentFleetDevice=(model:AppModel):FleetDevice|undefined=>model.fleet.devices.find(d=>d.id===model.fleet.selectedDeviceId)??model.fleet.devices.find(d=>d.status==='connected')??model.fleet.devices[0];
export const selectFleetHealth=(model:AppModel)=>({agents:model.fleet.agents.length,devices:model.fleet.devices.length,running:model.fleet.agents.filter(a=>a.status==='running').length,disconnected:model.fleet.devices.filter(d=>d.status==='disconnected'||d.status==='offline').length});
