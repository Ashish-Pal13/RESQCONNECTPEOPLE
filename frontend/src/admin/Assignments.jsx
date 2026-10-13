import React,{useState} from 'react';
import {api} from '../api';
import {useData,usePagedData,EMPTY_PAGE} from '../lib/useData';
import {useDebounced} from '../lib/useDebounced';
import {Badge,Empty,FilterBar,Loading,Notice,PageHeading,Pagination,useNotice} from '../lib/ui';
import {assignmentCode,formatDateTime,incidentCode,volunteerCode} from '../lib/format';
import {ASSIGNMENT_STATUSES,isOpenAssignment} from '../lib/assignments';
import {useHighlight} from '../lib/useHighlight';
export default function Assignments(){
 const [search,setSearch]=useState('');
 const [status,setStatus]=useState('');
 const term=useDebounced(search.trim());
 const assignments=usePagedData('/assignments',{search:term,status},10);
 const incidents=useData('/incidents?status=open&page=1&pageSize=100',EMPTY_PAGE);
 const volunteers=useData('/volunteers?eligible=true&page=1&pageSize=100',EMPTY_PAGE);
 const openIncidents=incidents.data.data||[];
 const eligibleVolunteers=volunteers.data.data||[];
 const notice=useNotice();
 const [busy,setBusy]=useState(false);
 const [cancellingId,setCancellingId]=useState(null);
 useHighlight(!assignments.loading);
 async function createAssignment(event){
  event.preventDefault();
  const form=event.currentTarget;
  const data=new FormData(form);
  const volunteer=eligibleVolunteers.find(v=>String(v.id)===data.get('volunteerId'));
  const incident=openIncidents.find(i=>String(i.id)===data.get('incidentId'));
  notice.clear();
  if(!volunteer||!incident){notice.fail('Please select a valid incident and volunteer.');return}
  setBusy(true);
  try{
   const created=await api('/assignments',{method:'POST',body:{incident_id:incident.id,volunteer_id:volunteer.id,task:data.get('task'),instructions:String(data.get('instructions')||'').trim()}});
   form.reset();
   notice.success(`${assignmentCode(created.id)} created. ${volunteer.name} has been notified and can accept or decline it.`);
   assignments.setPage(1);assignments.reload();
  }catch(err){notice.fail(err.message)}
  finally{setBusy(false)}
 }
 async function cancelAssignment(a){
  const reason=window.prompt(`Cancel ${assignmentCode(a.id)} for ${a.volunteer_name}? The volunteer will be notified.\n\nOptional reason:`,'');
  if(reason===null)return;
  setCancellingId(a.id);notice.clear();
  try{await api(`/assignments/${a.id}`,{method:'PATCH',body:{status:'Cancelled',reason:reason.trim()}});notice.success(`${assignmentCode(a.id)} cancelled.`)}
  catch(err){notice.fail(err.message)}
  finally{setCancellingId(null);assignments.reload()}
 }
 const filtered=Boolean(term||status);
 return <>
  <PageHeading title="Volunteer Assignments" subtitle="Create assignments and follow their progress."/>
  <div className="notice">
   New assignments start as <strong>Notified</strong>. The volunteer accepts or declines and updates progress from their dashboard; coordinators can cancel an open assignment. Assignments that are still open are cancelled automatically when their emergency report is resolved.
  </div>
  {notice.element}
  <Notice message={assignments.error||incidents.error||volunteers.error}/>
  <section className="panel">
   <h2>Create Assignment</h2>
   <form id="assignmentForm" className="form-grid" onSubmit={createAssignment}>
    <div>
     <label htmlFor="assignmentIncident">Emergency Report</label>
     <select id="assignmentIncident" name="incidentId" required defaultValue="">
      <option value="">{incidents.loading?'Loading reports...':openIncidents.length?'Select report':'No open reports'}</option>
      {openIncidents.map(i=><option key={i.id} value={i.id}>{incidentCode(i.id)} — {i.type} ({i.location})</option>)}
     </select>
    </div>
    <div>
     <label htmlFor="assignmentVolunteer">Volunteer</label>
     <select id="assignmentVolunteer" name="volunteerId" required defaultValue="">
      <option value="">{volunteers.loading?'Loading volunteers...':eligibleVolunteers.length?'Select volunteer':'No eligible volunteers'}</option>
      {eligibleVolunteers.map(v=><option key={v.id} value={v.id}>{v.name} — {volunteerCode(v.id,v.category)} ({v.category})</option>)}
     </select>
    </div>
    <div className="full-width">
     <label htmlFor="assignmentTask">Task</label>
     <select id="assignmentTask" name="task" required>
      <option>Food distribution</option><option>Ration distribution</option>
      <option>Sanitation support</option><option>Transport coordination</option>
      <option>Shelter support</option><option>First aid support</option>
      <option>General logistics</option>
     </select>
    </div>
    <div className="full-width">
     <label htmlFor="assignmentInstructions">Instructions</label>
     <textarea id="assignmentInstructions" name="instructions" maxLength={2000} placeholder="Task details and meeting point"></textarea>
    </div>
    <div className="full-width">
     <button className="btn" type="submit" disabled={busy}>{busy?'Creating...':'Create Assignment'}</button>
    </div>
   </form>
   {(incidents.data.pagination?.total>100||volunteers.data.pagination?.total>100)&&<p className="muted">Only the 100 most recent open reports and eligible volunteers are listed.</p>}
  </section>
  <section className="panel">
   <h2>Assignment Tracker</h2>
   <FilterBar>
    <div>
     <label htmlFor="assignmentSearch">Search</label>
     <input id="assignmentSearch" type="search" placeholder="Assignment ID, task, volunteer or location" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)}/>
    </div>
    <div>
     <label htmlFor="assignmentStatusFilter">Status</label>
     <select id="assignmentStatusFilter" value={status} onChange={e=>setStatus(e.target.value)}>
      <option value="">All statuses</option>
      <option value="open">Open (not finished)</option>
      {ASSIGNMENT_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
     </select>
    </div>
   </FilterBar>
   {assignments.loading&&!assignments.rows.length?<Loading/>:assignments.rows.length?
    <div className="table-wrap"><table>
     <thead><tr><th>Assignment</th><th>Incident</th><th>Volunteer</th>
     <th>Task</th><th>Status</th><th>Action</th></tr></thead>
     <tbody>{assignments.rows.map(a=><tr key={a.id} data-highlight={a.id}>
      <td><strong>{assignmentCode(a.id)}</strong><br/><span className="muted">{formatDateTime(a.created_at)}</span>{a.duplicate_of&&<><br/><span className="muted">Duplicate of {assignmentCode(a.duplicate_of)}</span></>}</td>
      <td>{incidentCode(a.incident_id)}<div className="muted">{a.incident_type} · {a.incident_location}</div></td>
      <td>{a.volunteer_name}<br/><span className="muted">{volunteerCode(a.volunteer_id,a.volunteer_category)}</span></td>
      <td>{a.task}{a.instructions&&<div className="muted">{a.instructions}</div>}</td>
      <td><Badge status={a.status}/>{a.status_reason&&<div className="muted status-reason">{a.status_reason}</div>}</td>
      <td>{isOpenAssignment(a.status)
       ?<button type="button" className="btn btn-danger btn-small" disabled={cancellingId===a.id} onClick={()=>cancelAssignment(a)}>{cancellingId===a.id?'Cancelling...':'Cancel'}</button>
       :<span className="muted">No action</span>}</td>
     </tr>)}</tbody>
    </table></div>
   :<Empty>{filtered?'No assignments match these filters.':'No assignments created yet.'}</Empty>}
   <Pagination pagination={assignments.pagination} onPage={assignments.setPage} noun="assignments" loading={assignments.loading}/>
  </section>
 </>;
}
