import React,{useEffect} from 'react';
import {useSearchParams} from 'react-router-dom';
import {api} from '../api';
import {useData} from '../lib/useData';
import {Badge,Empty,Loading,Notice,PageHeading,useNotice} from '../lib/ui';
import {formatDateTime} from '../lib/format';
import {FormGrid,field} from './FormGrid';
import {useHighlight} from '../lib/useHighlight';
const TICKET_CATEGORIES=['Account','Emergency Report','Volunteer','Technical Issue','Other'];
export default function MyTickets(){
 const [params]=useSearchParams();
 const requested=params.get('category');
 const category=TICKET_CATEGORIES.includes(requested)?requested:undefined;
 useEffect(()=>{if(category)document.getElementById('ticket-subject')?.focus()},[category]);
 const {data,loading,error,reload}=useData('/tickets');
 const notice=useNotice();
 useHighlight(!loading);
 async function save(d){notice.clear();await api('/tickets',{method:'POST',body:d});reload();notice.success('Ticket submitted to admin')}
 return <>
  <PageHeading eyebrow="SUPPORT DESK" title="My Support Tickets" subtitle="Submit questions and track admin responses."/>
  <section className="panel">
   <h2>Create Support Ticket</h2>
   {category&&<div className="notice success-notice" role="status">Topic selected: <strong>{category}</strong>. Add a subject and describe your issue below.</div>}
   <FormGrid key={category||'default'} id="ticket" onSave={save} button="Submit Ticket" fields={[
    field('subject','Subject',{max:180}),
    field('category','Category',{options:TICKET_CATEGORIES,defaultValue:category}),
    field('message','Describe your issue',{wide:true,multiline:true})
   ]}/>
  </section>
  {notice.element}
  <Notice message={error}/>
  {loading&&!data.length?<section className="panel"><Loading/></section>:data.length===0?(!error&&<section className="panel"><h2>Tickets</h2><Empty>No support tickets yet.</Empty></section>):data.map(t=>
   <article className="panel" key={t.id} data-highlight={t.id}>
    <div className="panel-header">
     <div>
      <div className="eyebrow">TICKET #{t.id} · {t.category}</div>
      <h2 className="ticket-subject">{t.subject}</h2>
      <div className="muted">{formatDateTime(t.created_at)}</div>
     </div>
     <Badge status={t.status}/>
    </div>
    <p className="ticket-message">{t.message}</p>
    {t.admin_reply&&<div className="notice success-notice reply-box"><strong>Admin response</strong><div>{t.admin_reply}</div><div className="muted">Updated {formatDateTime(t.updated_at)}</div></div>}
   </article>
  )}
 </>;
}
