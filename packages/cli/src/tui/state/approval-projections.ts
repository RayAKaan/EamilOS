import type {AppModel} from '../model.js';import type {ApprovalRequest} from '../approval-data.js';
export const selectApprovals=(m:AppModel):ApprovalRequest[]=>m.approvals.requests;
export const selectPendingApprovals=(m:AppModel)=>m.approvals.requests.filter(a=>a.status==='pending');
export const selectCurrentApproval=(m:AppModel):ApprovalRequest|undefined=>m.approvals.requests.find(a=>a.id===m.approvals.selectedApprovalId)??selectPendingApprovals(m)[0];
