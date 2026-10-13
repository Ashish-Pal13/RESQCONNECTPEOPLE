export const ASSIGNMENT_STATUSES=['Notified','Accepted','In Progress','Completed','Declined','Cancelled'];
export const OPEN_ASSIGNMENT_STATUSES=['Notified','Accepted','In Progress'];
export const CLOSED_ASSIGNMENT_STATUSES=['Completed','Declined','Cancelled'];
export const INACTIVE_ASSIGNMENT_STATUSES=['Declined','Cancelled'];
const TRANSITIONS={
 volunteer:{Notified:['Accepted','Declined'],Accepted:['In Progress','Declined'],'In Progress':['Completed']},
 coordinator:{Notified:['Cancelled'],Accepted:['Cancelled'],'In Progress':['Cancelled']}
};
export function allowedNextStatuses(actor,from){return TRANSITIONS[actor]?.[from]??[]}
export function checkAssignmentTransition(actor,from,to){
 if(!ASSIGNMENT_STATUSES.includes(to))return {status:400,error:'Unknown assignment status.'};
 if(from===to)return {status:409,error:`This assignment is already ${to}.`};
 if(CLOSED_ASSIGNMENT_STATUSES.includes(from))return {status:409,error:`This assignment is ${from.toLowerCase()} and can no longer be changed.`};
 if(allowedNextStatuses(actor,from).includes(to))return null;
 const other=actor==='volunteer'?'coordinator':'volunteer';
 if(allowedNextStatuses(other,from).includes(to)){
  return {status:403,error:actor==='coordinator'?`Only the assigned volunteer can mark this assignment ${to}.`:'Only a coordinator can cancel an assignment.'};
 }
 return {status:409,error:`An assignment cannot move from ${from} to ${to}.`};
}
