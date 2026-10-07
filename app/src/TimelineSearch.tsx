import { appPath } from './paths';
import { useEffect, useState } from 'react';

export type TimelineHit = {id:string;regulation_id:string;regulation_name:string;effective_date:string;
  short_label:string;topics:string[];article_summary:string;context:string;focus_article:string;search_text:string};

const normalize=(value:string)=>value.toLocaleLowerCase('nl').normalize('NFD').replace(/\p{M}/gu,'')
  .replace(/\bri\s*&\s*e\b/gu,'rie').replace(/[^\p{L}\p{N}.]+/gu,' ').trim();
const dateLabel=(day:string)=>new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));

export default function TimelineSearch({onChoose}:{onChoose:(hit:TimelineHit)=>void}) {
  const [index,setIndex]=useState<TimelineHit[]>([]);
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{let cancelled=false;
    fetch(appPath('/data/timeline-search-index.json')).then(r=>{if(!r.ok)throw new Error('Zoekindex van wijzigingen ontbreekt');return r.json()})
      .then(data=>{if(!cancelled)setIndex(data)}).catch(e=>{if(!cancelled)setError(e.message)});
    return()=>{cancelled=true};
  },[]);
  const terms=normalize(query).split(' ').filter(Boolean);
  const hits=terms.length?index.filter(hit=>{const haystack=normalize(hit.search_text);return terms.every(term=>
    term.length<=3?haystack.split(' ').includes(term):haystack.includes(term))}).sort((a,b)=>{
      const score=(hit:TimelineHit)=>normalize(hit.short_label).startsWith(normalize(query))?2:0;
      return score(b)-score(a)||b.effective_date.localeCompare(a.effective_date);
    }):[];
  return <div className="timeline-search">
    <label htmlFor="timeline-search-input">Zoek een wetswijziging <span>in Arbowet én Arbobesluit</span></label>
    <div className="timeline-search-field"><input id="timeline-search-input" type="search" aria-label="Zoek wetswijziging" placeholder="ARIE, asbest, bedrijfsarts, artikel of jaar…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setQuery('')}}/>
      {query&&<button onClick={()=>setQuery('')} aria-label="Wis zoeken naar wetswijzigingen">×</button>}</div>
    <div className="topic-shortcuts"><span>Onderwerpen</span>{['ARIE','RI&E','Asbest','ATEX'].map(topic=><button key={topic} onClick={()=>setQuery(topic)}>{topic}</button>)}</div>
    {error&&<p className="error" role="alert">{error}</p>}
    {terms.length>0&&<section className="timeline-search-results" aria-label="Gevonden wetswijzigingen">
      <p role="status">{index.length?`${hits.length} wijzigingen gevonden${hits.length>12?' · eerste 12 getoond':''}`:'Zoekindex laden…'}</p>
      {hits.slice(0,12).map(hit=><button key={hit.id} data-search-event={hit.id} onClick={()=>onChoose(hit)}>
        <span className="result-date">{dateLabel(hit.effective_date)}</span><strong>{hit.short_label}</strong>
        <span>{hit.regulation_name} · {hit.context||hit.article_summary}</span>
        <small>{hit.context?hit.article_summary:hit.topics.join(' · ')} · Bekijk op tijdlijn →</small>
      </button>)}
      {index.length>0&&!hits.length&&<p>Geen wijziging gevonden. Zoek ook op artikelnummer, jaar of bronnummer.</p>}
    </section>}
  </div>;
}
