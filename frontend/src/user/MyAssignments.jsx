import React,{useState} from 'react';
import {api} from '../api';
import {useData} from '../lib/useData';
import {Badge,Empty,Loading,Notice,PageHeading,useNotice} from '../lib/ui';
import {assignmentCode,formatDateTime,incidentCode} from '../lib/format';
import {VOLUNTEER_ACTIONS} from '../lib/assignments';
import {useHighlight} from '../lib/useHighlight';
const DONE_MESSAGES={Accepted:'accepted',Declined:'declined','In Progress':'marked in progress',Completed:'marked completed'};
export default function MyAssignments(){
 const {data,loading,error,reload}=useData('/assignments');
 const notice=useNotice();
 const [busyId,setBusyId]=useState(null);
 useHighlight(!loading);
 async function update(assignment,action){
  let reason='';
  if(action.status==='Declined'){
   const answer=window.prompt(`${action.label} ${assignmentCode(assignment.id)}? The coordinators will be notified.\n\nOptional reason:`,'');
   if(answer===null)return;
   reason=answer.trim();
  }
  if(action.status==='Completed'&&!window.confirm(`Mark ${assignmentCode(assignment.id)} as completed? This cannot be undone.`))return;
  notice.clear();setBusyId(assignment.id);
  try{await api(`/assignments/${assignment.id}`,{method:'PATCH',body:{status:action.status,reason}});notice.success(`${assignmentCode(assignment.id)} ${DONE_MESSAGES[action.status]}.`)}
  catch(e){notice.fail(e.message)}
  finally{setBusyId(null);reload()}
 }
 return <>
  <PageHeading eyebrow="TASK COORDINATION" title="My Assignments" subtitle="Accept new tasks, update your progress and see what has changed."/>
  {notice.element}
  <Notice message={error}/>
  <section className="panel">
   <h2>Assignment Tracker</h2>
   {loading&&!data.length?<Loading/>:data.length?
    <div className="table-wrap"><table>
     <thead><tr><th>ID</th><th>Incident</th><th>Task</th><th>Status</th><th>Actions</th></tr></thead>
     <tbody>{data.map(r=>{
      const actions=VOLUNTEER_ACTIONS[r.status]||[];
      return <tr key={r.id} data-highlight={r.id}>
       <td><strong>{assignmentCode(r.id)}</strong><div className="muted">{formatDateTime(r.created_at)}</div></td>
       <td>{incidentCode(r.incident_id)}<div className="muted">{r.incident_type} · {r.incident_location}</div></td>
       <td>{r.task}{r.instructions&&<div className="muted">{r.instructions}</div>}</td>
       <td><Badge status={r.status}/>{r.status_reason&&<div className="muted status-reason">{r.status_reason}</div>}</td>
       <td>{actions.length
        ?<div className="action-row">{actions.map(action=><button key={action.status} type="button" className={action.tone==='danger'?'btn btn-danger btn-small':'btn btn-small'} disabled={busyId===r.id} onClick={()=>update(r,action)}>{action.label}</button>)}</div>
        :<span className="muted">{r.status==='Completed'?'Finished':'No action needed'}</span>}</td>
      </tr>;
     })}</tbody>
    </table></div>
   :<Empty>No assignments yet. When a coordinator assigns you a task it will appear here.</Empty>}
  </section>
 </>;
}
