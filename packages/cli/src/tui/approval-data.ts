import type {ResourceRef} from './mission-data.js';
export type ApprovalRisk='low'|'medium'|'high'|'critical';
export type ApprovalStatus='pending'|'approved'|'denied'|'expired'|'cancelled';
export type ApprovalResolution='approve'|'deny'|'approve-once'|'approve-session';
export interface ApprovalRequest{id:string;missionId:string;decisionId?:string;action:string;reason:string;risk:ApprovalRisk;policy?:string;affectedResources:ResourceRef[];affectedFiles:string[];affectedDevices:string[];requestedBy:string;createdAt:number;status:ApprovalStatus;resolvedAt?:number;resolution?:ApprovalResolution;}
export interface ApprovalState{requests:ApprovalRequest[];selectedApprovalId?:string;}
export function initialApprovalState():ApprovalState{return{requests:[]};}
