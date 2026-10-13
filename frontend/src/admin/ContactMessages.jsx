import React from 'react';
import {useData} from '../lib/useData';
import {Empty,Loading,Notice,PageHeading} from '../lib/ui';
import {formatDateTime} from '../lib/format';
import {useHighlight} from '../lib/useHighlight';
import {formatPhone} from '../lib/phone';
export default function ContactMessages(){
 const {data,loading,error}=useData('/contact');
 useHighlight(!loading);
 return <>
  <PageHeading eyebrow="COMMUNICATIONS" title="Contact Messages" subtitle="Messages received from the public contact form."/>
  <Notice message={error}/>
  <section className="panel">
   <h2>Inbox</h2>
   {loading&&!data.length?<Loading/>:data.length?
    <div className="table-wrap"><table>
     <thead><tr><th>Sender</th><th>Phone</th><th>Subject</th><th>Message</th><th>Received</th></tr></thead>
     <tbody>{data.map(m=><tr key={m.id} data-highlight={m.id}>
      <td>{m.name}<br/><span className="muted">{m.email}</span></td>
      <td>{m.phone?<a className="tel-link" href={`tel:${m.phone}`}>{formatPhone(m.phone,m.phone_country)}</a>:<span className="muted">Not provided</span>}</td>
      <td>{m.subject}</td>
      <td>{m.message}</td>
      <td>{formatDateTime(m.created_at)}</td>
     </tr>)}</tbody>
    </table></div>
   :<Empty>No records available</Empty>}
  </section>
 </>;
}
