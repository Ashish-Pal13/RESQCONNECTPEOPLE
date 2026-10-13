import React,{useEffect} from 'react';
import {useSearchParams} from 'react-router-dom';
import {api} from '../api';
import {useData} from '../lib/useData';
import {Badge,Empty,Loading,Notice,PageHeading,useNotice} from '../lib/ui';
import {formatDateTime,incidentCode} from '../lib/format';
import {FormGrid,field} from './FormGrid';
import {useHighlight} from '../lib/useHighlight';
const INCIDENT_TYPES=['Flood','Fire','Earthquake','Landslide','Storm','Other'];
export default function MyReports(){
 const [params]=useSearchParams();
 const requested=params.get('type');
 const type=INCIDENT_TYPES.includes(requested)?requested:undefined;
 useEffect(()=>{if(type)document.getElementById('report-location')?.focus()},[type]);
 const {data,loading,error,reload}=useData('/incidents');
 const notice=useNotice();
 useHighlight(!loading);
 async function save(d){notice.clear();await api('/incidents',{method:'POST',body:d});notice.success('Emergency report submitted');reload()}
 return <>
  <PageHeading eyebrow="EMERGENCY RESPONSE" title="My Emergency Reports" subtitle="Submit and track your emergency reports."/>
  <section className="panel">
   <h2>Submit a new report</h2>
   {type&&<div className="notice success-notice" role="status">Incident type selected: <strong>{type}</strong>. Add the location and describe what is happening below.</div>}
   <FormGrid key={type||'default'} id="report" onSave={save} button="Submit Report" fields={[
    field('type','Incident Type',{options:INCIDENT_TYPES,defaultValue:type}),
    field('urgency','Urgency',{options:['Low','Medium','High','Critical']}),
    field('location','Location',{wide:true}),
    field('description','Description',{wide:true,multiline:true})
   ]}/>
  </section>
  {notice.element}
  <Notice message={error}/>
  <section className="panel">
   <h2>Report History</h2>
   {loading&&!data.length?<Loading/>:data.length?
    <div className="table-wrap"><table>
     <thead><tr><th>ID</th><th>Incident</th><th>Location</th><th>Urgency</th><th>Status</th><th>Created</th></tr></thead>
     <tbody>{data.map(r=><tr key={r.id} data-highlight={r.id}>
      <td>{incidentCode(r.id)}</td>
      <td><strong>{r.type}</strong><div className="muted">{r.description}</div></td>
      <td>{r.location}</td>
      <td><Badge status={r.urgency}/></td>
      <td><Badge status={r.status}/></td>
      <td>{formatDateTime(r.created_at)}</td>
     </tr>)}</tbody>
    </table></div>
   :<Empty>No records available</Empty>}
  </section>
 </>;
}
