import React from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '../context/Auth';
import {useData} from '../lib/useData';
import {Notice,PageHeading,StatCard} from '../lib/ui';
export default function Overview(){
 const {user}=useAuth();
 const incidents=useData('/incidents');
 const tickets=useData('/tickets');
 const volunteers=useData('/volunteers');
 const show=(loading,value)=>loading?'—':value;
 const mine=volunteers.data[0];
 return <>
  <PageHeading eyebrow="MY COMMUNITY" title={`Welcome, ${user?.name}`} subtitle="Track community activity and manage your response workflows."/>
  <Notice message={incidents.error||tickets.error||volunteers.error}/>
  <div className="cards">
   <StatCard label="My Reports" value={show(incidents.loading,incidents.data.length)}/>
   <StatCard label="My Tickets" value={show(tickets.loading,tickets.data.length)}/>
   <StatCard label="Volunteer Profile" value={show(volunteers.loading,volunteers.data.length)} note={volunteers.loading?'':mine?mine.verification:'Not registered'}/>
  </div>
  <section className="panel">
   <h2>Quick access</h2>
   <div className="action-row">
    {[['Submit an Emergency Report','/dashboard/incidents'],['Become a Volunteer','/dashboard/volunteer'],['Open a Support Ticket','/dashboard/tickets']].map(([label,path])=><Link className="btn btn-secondary portal-link" to={path} key={path}>{label} →</Link>)}
   </div>
  </section>
 </>;
}
