import { appPath, rawSourceUrl } from './paths';
import React, { useEffect, useRef, useState } from 'react';
import './timeline.css';
import TimelineSearch, { type TimelineHit } from './TimelineSearch';

type Importance = 'major'|'minor'|'unknown';
type MiniEvent = {id:string;date:string;kind:string;title:string;publication_id?:string;origin:string};
type MiniStep = {id:string;label:string;title:string;subtitle?:string;importance:Importance};
type Source = { title:string; url:string; source_file?:string; archive_error?:string };
type LessonArticleRef = {label:string;regulation_id:string;article:string;date?:string};
type LessonEvent = { id:string; year:number; date:string|null; date_precision:string; date_kind:string; title:string; summary:string; icon:string; category:string; sources:string[]; fact:string; meaning:string; question:string; answer:string; confidence:string; importance:Importance; importance_reason:string; parent_event_id:string|null; topics?:string[]; legal_refs?:LessonArticleRef[]; register_target?:{regulation_id:string;article:string} };
type Incident = Omit<LessonEvent,'importance'|'importance_reason'|'parent_event_id'|'icon'> & {kind:'incident';country:string};
type Development = {title:string;summary:string;phases:{event_id:string;label:string}[];sources:string[]};
type Lesson = { title:string; subtitle:string; as_of:string; events:LessonEvent[]; incidents:Incident[]; responsibility_development:Development; sources:Record<string,Source> };
type AffectedArticle={number:string;heading:string;evidence:string;state_id:string|null};
type LawEvent = { id:string; effective_date:string|null; title:string; summary:string; publication_ids:string[]; commencement_publication_ids:string[]; notes:string[]; article?:string; change_count?:number; importance:Importance; importance_reason:string; mini_events:MiniEvent[]; editorial_title?:string|null; extent:'broad'|'limited'|'unknown'; display_level:Importance; changed_article_count:number|null; extent_basis:string;
  short_label:string;regulation_name:string;regulation_id:string;article_summary:string;context:string;topics:string[];detail:string;subject_sources:string[];affected_articles:AffectedArticle[];
  source_publications:{id:string;title:string;label:string;metadata_source_file:string|null}[] };
type LawTimeline = { title:string; regulation_id:string; article_number?:string; events:LawEvent[]; undated_events:{effect:string; publication_ids:string[]; commencement_publication_ids:string[]; notes:string[]}[] };
type Props = { mode:'lesson'|'register'; regulationId:string; articleNumber:string; initialDate?:string; onOpen:(regulationId:string,article:string,date?:string)=>void; onDate:(day:string)=>void; onPublication:(id:string)=>void; publicationError:string };
const dateLabel=(day:string|null)=>day?new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z')):'';

function Illustration({ kind }: { kind:string }) {
  const common={fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  return <svg viewBox="0 0 120 100" aria-hidden="true" className="history-illustration"><circle className="art-disc" cx="68" cy="40" r="35"/>
    <g {...common}>
      {kind==='mine'?<><path d="M13 89V49l28-25 29 25v40M41 24v65M13 49h57M13 89l57-40M70 89 13 49M78 89V66h26v23Z"/><path d="m82 59 18-21 11 14M89 52l14 9M23 27 8 16M15 10 3 26"/></>:null}
      {kind==='factory'?<><path d="M9 88V49l21 11V46l21 13V43l25 17V88ZM80 88V22h15v66M84 14l5-7M99 16l6-5M16 70h7v9h-7ZM37 70h7v9h-7ZM58 70h7v9h-7Z"/></>:null}
      {kind==='clock'?<><circle cx="57" cy="48" r="31"/><path d="M57 25v25l18 9M49 9h16M57 9v8M23 22l-8 9M88 22l8 9M29 82l-9 9M85 82l9 9"/></>:null}
      {kind==='child'||kind==='people'||kind==='inspect'||kind==='care'?<><circle cx="54" cy="29" r="12"/><path d="M32 87V64c0-17 10-24 22-24s22 7 22 24v23M43 85V65M65 65v20"/>{kind==='people'?<><circle cx="91" cy="43" r="9"/><path d="M80 86V67c0-9 4-15 11-15s13 6 13 15v19M18 86V70c0-9 3-14 8-14"/></>:null}{kind==='inspect'?<><path d="M48 12h14l5 10H41ZM73 64h27v29H73Z"/><path d="m79 75 4 4 10-11M79 87h14"/></>:null}{kind==='care'?<><path d="M84 16v22M73 27h22M40 60h29M48 59v14h13V59"/></>:null}{kind==='child'?<><path d="M16 87V63h11v24M83 87V45h19v42M19 54v-8M87 32l5-8M92 38l12-2"/></>:null}</>:null}
      {kind==='europe'?<>{Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return <circle key={i} cx={58+36*Math.sin(a)} cy={49-36*Math.cos(a)} r="2"/>})}<path d="M45 66V31h25M45 47h21M45 65h25"/></>:null}
      {kind==='layers'?<><path d="m17 31 43-20 43 20-43 21ZM17 49l43 20 43-20M17 69l43 20 43-20"/></>:null}
      {kind==='handshake'?<><path d="m13 48 22-17 23 6 16-3 31 17-17 30-22-4-12 6-26-17ZM13 48l15 18M105 51 88 81M58 37 42 51l8 10 16-12 22 17M48 70l10 9M60 66l13 11"/></>:null}
      {['book','checklist','document'].includes(kind)?<><path d="M24 13h56l15 15v62H24ZM80 13v17h15M38 37h42M38 49h42M38 61h42M38 73h29"/>{kind==='checklist'?<path d="m11 42 5 5 12-14M11 66l5 5 12-14"/>:null}</>:null}
    </g></svg>;
}

function MiniTimeline({ title, steps, selectedId, onSelect }: {title:string;steps:MiniStep[];selectedId:string;onSelect:(id:string)=>void}) {
  const track=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const container=track.current;
    const button=container?.querySelector<HTMLElement>(`[data-mini-id="${selectedId}"]`);
    if(container&&button)container.scrollTo({left:button.offsetLeft-(container.clientWidth-button.clientWidth)/2,behavior:'auto'});
  },[selectedId]);
  return <section className="mini-timeline" aria-label={title}>
    <div className="mini-heading"><div className="timeline-kicker">MINITIJDLIJN · {steps.length} STAPPEN</div><h2>{title}</h2></div>
    <div className="mini-track" ref={track} onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
      const focused=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-mini-id]');
      if(!focused)return;
      const index=steps.findIndex(step=>step.id===focused.dataset.miniId);
      const next=steps[Math.max(0,Math.min(steps.length-1,index+(event.key==='ArrowRight'?1:-1)))];
      if(next){event.preventDefault();onSelect(next.id);track.current?.querySelector<HTMLButtonElement>(`[data-mini-id="${next.id}"]`)?.focus()}
    }}>
      <div className="mini-stage">
        {steps.map(step=><button key={step.id} data-mini-id={step.id} className={`mini-step ${step.importance} ${selectedId===step.id?'current':''}`} aria-pressed={selectedId===step.id} aria-label={`${step.label}: ${step.title}`} onClick={()=>onSelect(step.id)}>
          <span className="mini-date">{step.label}</span><span className="mini-dot"/><strong>{step.title}</strong>{step.subtitle&&<small>{step.subtitle}</small>}
        </button>)}
      </div>
    </div>
  </section>;
}

function IncidentTimeline({incidents,selectedId,onSelect}:{incidents:Incident[];selectedId:string;onSelect:(id:string)=>void}){
  const track=useRef<HTMLDivElement>(null);
  useEffect(()=>{const button=track.current?.querySelector<HTMLElement>(`[data-incident-id="${selectedId}"]`);if(button)track.current?.scrollTo({left:button.offsetLeft,behavior:'auto'})},[selectedId]);
  return <section className="incident-timeline" aria-label="Incidenten bij het lesverhaal"><div className="incident-heading"><span className="timeline-kicker">INCIDENTEN · {incidents.length} CASUSSEN</span><span>Klik voor de lesvraag</span></div>
    <div className="incident-track" ref={track} onKeyDown={e=>{
      if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
      const focused=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-incident-id]');if(!focused)return;
      const index=incidents.findIndex(i=>i.id===focused.dataset.incidentId);
      const next=incidents[Math.max(0,Math.min(incidents.length-1,index+(e.key==='ArrowRight'?1:-1)))];
      if(next){e.preventDefault();onSelect(next.id);track.current?.querySelector<HTMLButtonElement>(`[data-incident-id="${next.id}"]`)?.focus()}
    }}><div className="incident-stage">{incidents.map(i=><button key={i.id} data-incident-id={i.id} className={`incident-step ${selectedId===i.id?'current':''}`} aria-pressed={selectedId===i.id} aria-label={`${dateLabel(i.date)}: ${i.title}`} onClick={()=>onSelect(i.id)}>
      <span className="incident-date">{dateLabel(i.date)}</span><span className="incident-dot"/><strong>{i.title}</strong><small>{i.summary} · {i.country}</small>
    </button>)}</div></div>
  </section>;
}

export default function Timeline({mode,regulationId,articleNumber,initialDate,onOpen,onDate,onPublication,publicationError}:Props){
  const [lesson,setLesson]=useState<Lesson>();
  const [law,setLaw]=useState<LawTimeline>();
  const [timelineRequest,setTimelineRequest]=useState(0);
  const [scope,setScope]=useState('regulation');
  const [lessonLevel,setLessonLevel]=useState('major');
  const [lessonBuild,setLessonBuild]=useState(true);
  const [revealedThroughId,setRevealedThroughId]=useState('mine1810');
  const [newlyRevealedId,setNewlyRevealedId]=useState('');
  const [lawLevel,setLawLevel]=useState('all');
  const [selectedId,setSelectedId]=useState('');
  const [selectedMiniId,setSelectedMiniId]=useState('');
  const [selectedIncidentId,setSelectedIncidentId]=useState('');
  const [showAnswer,setShowAnswer]=useState(false);
  const [presentation,setPresentation]=useState(false);
  const [error,setError]=useState('');
  const track=useRef<HTMLDivElement>(null);
  const miniRegion=useRef<HTMLDivElement>(null);
  const [revealMini,setRevealMini]=useState(false);
  const [pendingEvent,setPendingEvent]=useState<Pick<TimelineHit,'regulation_id'|'effective_date'> & {id?:string}>();
  const scopedArticle=scope==='article'?articleNumber:'';
  const eventLevel=(event:LessonEvent|LawEvent):Importance=>'display_level' in event?event.display_level:event.importance;
  const level=mode==='lesson'?lessonLevel:lawLevel;
  useEffect(()=>{fetch(appPath('/data/lesson-timeline.json')).then(r=>{if(!r.ok)throw new Error('Lestijdlijn ontbreekt');return r.json()}).then(setLesson).catch(e=>setError(e.message))},[]);
  useEffect(()=>{
    if(mode==='lesson')return;
    let cancelled=false;setLaw(undefined);setError('');
    const path=scope==='article'?`/data/regulations/${regulationId}/articles/${encodeURIComponent(articleNumber)}-timeline.json`:`/data/regulations/${regulationId}/timeline.json`;
    fetch(appPath(path)).then(r=>{if(!r.ok)throw new Error('Tijdlijn ontbreekt');return r.json()}).then(data=>{if(!cancelled)setLaw({...data,article_number:scope==='article'?articleNumber:undefined})}).catch(e=>{if(!cancelled)setError(e.message)});
    return ()=>{cancelled=true};
  },[mode,scope,regulationId,scopedArticle,timelineRequest]);
  const allEvents: (LessonEvent|LawEvent)[]=mode==='lesson'?lesson?.events||[]:law?.events||[];
  const majorEvents=allEvents.filter(event=>eventLevel(event)==='major');
  const fullEvents=level==='major'?majorEvents:allEvents;
  const building=mode==='lesson'&&lessonBuild;
  const frontier=Math.max(0,lesson?.events.findIndex(e=>e.id===revealedThroughId)??0);
  const events=building?fullEvents.filter(e=>(lesson?.events.findIndex(item=>item.id===e.id)??0)<=frontier):fullEvents;
  const reachedYear=lesson?.events[frontier]?.year||1810;
  const visibleIncidents=lesson?.incidents.filter(i=>!building||i.year<=reachedYear)||[];
  const showDevelopment=mode==='lesson'&&(!building||reachedYear>=1980);
  const visiblePhases=lesson?.responsibility_development.phases.filter(p=>events.some(e=>e.id===p.event_id))||[];
  useEffect(()=>{
    if(mode==='register'&&pendingEvent){
      if(law?.regulation_id===pendingEvent.regulation_id&&!law.article_number){
        const target=pendingEvent.id?law.events.find(e=>e.id===pendingEvent.id):law.events.find(e=>e.effective_date===pendingEvent.effective_date)||law.events.filter(e=>e.effective_date&&(e.effective_date<=pendingEvent.effective_date)).at(-1);
        if(pendingEvent.id&&!target)return;
        if(target)setSelectedId(target.id);
        setSelectedMiniId('');onDate(pendingEvent.effective_date);setPendingEvent(undefined);
      }
      return;
    }
    const lawChoices=lawLevel==='major'?law?.events.filter(e=>e.display_level==='major'):law?.events;
    const initial=mode==='lesson'?lesson?.events.find(e=>e.importance==='major'):lawChoices?.find(e=>e.effective_date===initialDate)||lawChoices?.at(-1);
    const choices=mode==='lesson'?lesson?.events:lawChoices;
    setSelectedId(current=>choices?.some(e=>e.id===current)?current:initial?.id||'');setShowAnswer(false);setSelectedMiniId('');setSelectedIncidentId('');
  },[lesson,law,mode,pendingEvent,initialDate]);
  const selected=allEvents.find(event=>event.id===selectedId)||events[0];
  const parentId=selected&&'parent_event_id' in selected?(selected.parent_event_id||selected.id):selected?.id;
  const activeId=mode==='lesson'&&level==='major'?parentId:selected?.id;
  const index=Math.max(0,events.findIndex(event=>event.id===activeId));
  const select=(id:string,reveal=false)=>{
    if(reveal)setRevealMini(true);
    setSelectedId(id);setShowAnswer(false);setSelectedMiniId('');setSelectedIncidentId('');setNewlyRevealedId('');
    const event=allEvents.find(event=>event.id===id);
    if(mode==='register'&&event&&'effective_date' in event&&event.effective_date)onDate(event.effective_date);
  };
  const revealNext=(clickedId?:string)=>{
    if(!building||!lesson||clickedId&&clickedId!==events.at(-1)?.id)return;
    const next=fullEvents[events.length];
    if(!next)return;
    // Reaching the end of the main route also makes its optional later detail available.
    setRevealedThroughId(events.length===fullEvents.length-1?lesson.events.at(-1)!.id:next.id);
    setNewlyRevealedId(next.id);
  };
  const startBuild=()=>{
    setLessonBuild(true);setRevealedThroughId(lesson?.events[0]?.id||'mine1810');
    setSelectedId(lesson?.events[0]?.id||'mine1810');setSelectedIncidentId('');setSelectedMiniId('');setShowAnswer(false);setNewlyRevealedId('');setRevealMini(false);
  };
  const setLevel=(next:string)=>{
    setSelectedIncidentId('');setShowAnswer(false);
    if(mode==='lesson')setLessonLevel(next);else setLawLevel(next);
    if(mode==='register'&&next==='major'&&selected&&eventLevel(selected)!=='major'){
      const day=selected&&'effective_date' in selected?selected.effective_date||'':'';
      const previous=majorEvents.filter(e=>'effective_date' in e&&(e.effective_date||'')<=day).at(-1);
      setSelectedId((previous||majorEvents[0])?.id||'');setSelectedMiniId('');
    }
  };
  const step=(direction:number)=>{
    if(building&&direction>0&&index===events.length-1&&events.length<fullEvents.length){select(fullEvents[events.length].id);revealNext();return}
    const next=events[Math.max(0,Math.min(events.length-1,index+direction))];if(next)select(next.id);
  };
  const scrollTargetId=building&&newlyRevealedId?newlyRevealedId:activeId;
  useEffect(()=>{
    const container=track.current;const target=container?.querySelector<HTMLElement>(`[data-event-id="${scrollTargetId}"]`);
    if(!container||!target)return;
    const center=(behavior:ScrollBehavior)=>container.scrollTo({left:target.offsetLeft-(container.clientWidth-target.clientWidth)/2,behavior});
    center(matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth');
    let width=container.clientWidth;
    const resize=new ResizeObserver(()=>{if(container.clientWidth!==width){width=container.clientWidth;center('auto')}});resize.observe(container);
    return ()=>resize.disconnect();
  },[scrollTargetId,level,mode,building]);
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if(e.key==='Escape')setPresentation(false)};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[]);
  const activeIncident=mode==='lesson'?visibleIncidents.find(i=>i.id===selectedIncidentId):undefined;
  const lessonSelected=mode==='lesson'?activeIncident||selected as LessonEvent|undefined:undefined;
  const lawSelected=mode==='register'?selected as LawEvent|undefined:undefined;
  const family=lesson?.events.filter((e,i)=>(!building||i<=frontier)&&(e.id===parentId||e.parent_event_id===parentId))||[];
  useEffect(()=>{if(revealMini){miniRegion.current?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});setRevealMini(false)}},[selectedId,revealMini]);
  const parent=lesson?.events.find(e=>e.id===parentId);
  const title=(e:LessonEvent|LawEvent)=>'short_label' in e?e.short_label:e.title;
  const jumpToHit=(hit:TimelineHit)=>{setLaw(undefined);setTimelineRequest(v=>v+1);setPendingEvent(hit);setScope('regulation');setLawLevel('all');onOpen(hit.regulation_id,hit.focus_article,hit.effective_date)};
  const openLessonArticle=(ref:Omit<LessonArticleRef,'label'>)=>{
    const day=ref.date||lesson!.as_of;
    setLaw(undefined);setTimelineRequest(v=>v+1);setPendingEvent({regulation_id:ref.regulation_id,effective_date:day});setScope('regulation');setLawLevel('all');onOpen(ref.regulation_id,ref.article,day);
  };
  return <section className={`timeline-view ${mode==='register'?'register-timeline':'lesson-timeline'} ${building?'building':''} ${presentation?'presentation':''}`}>
    <div className="timeline-hero"><div>
      <div className="timeline-kicker">{mode==='lesson'?'HVK · LESDAG 1 · HISTORISCHE ONTWIKKELING':'JURIDISCH REGISTER · OFFICIËLE WIJZIGINGSHISTORIE'}</div>
      <h1>{mode==='lesson'?lesson?.title||'Hoe veilig werken wet werd':scope==='article'?`De geschiedenis van artikel ${articleNumber}`:law?.title||'Wijzigingen door de tijd'}</h1>
      <p>{mode==='lesson'?lesson?.subtitle:'Klik op een gebeurtenis voor de publicatie, inwerkingtreding en verdere uitwerking.'}</p>
    </div><div className="timeline-options">
      {mode==='register'&&<label>Toon<select aria-label="Tijdlijnbereik" value={scope} onChange={e=>setScope(e.target.value)}><option value="regulation">Hele regeling</option><option value="article">Geselecteerd artikel {articleNumber}</option></select></label>}
      <button onClick={()=>setPresentation(v=>!v)} aria-pressed={presentation}>{presentation?'Terug naar normaal':'Presenteren'}</button>
    </div></div>
    {mode==='register'&&<TimelineSearch onChoose={jumpToHit}/>}
    <div className="timeline-levels"><div className="level-switch" role="group" aria-label="Detailniveau van de tijdlijn">
      <button aria-pressed={level==='major'} disabled={!majorEvents.length} onClick={()=>setLevel('major')}>Hoofdmijlpalen <span>{majorEvents.length}</span></button>
      <button aria-pressed={level==='all'} onClick={()=>setLevel('all')}>{mode==='lesson'?'Alle stappen':'Alle wijzigingen'} <span>{allEvents.length}</span></button>
    </div><div className="importance-legend">
      <span><i className="major"/>{mode==='lesson'?'Grote mijlpaal':'Brede wijziging / hoofdmijlpaal'}</span>
      {mode==='lesson'?<span><i className="minor"/>Kleinere stap</span>:<><span><i className="minor"/>Beperkte wijziging</span><span><i className="unknown"/>Omvang onbekend</span></>}
    </div></div>
    <p className="importance-note">{mode==='lesson'?(building?'Klik op de laatst verschenen kaart om de volgende stap te onthullen. Eerdere kaarten kun je opnieuw bekijken.':'De grote mijlpalen vormen het lesverhaal. Klik voor de kleinere stappen binnen een mijlpaal.'):'Breed: vanaf 10 artikelen met berekende wijzigingen; beperkt: 1–9. Hoofdmijlpalen uit de les zijn ook uitgelicht. Omvang en juridische impact zijn verschillende beoordelingen.'}</p>
    {mode==='lesson'&&<div className="lesson-build-controls"><div role="group" aria-label="Opbouw van het lesverhaal"><button aria-pressed={lessonBuild} onClick={startBuild}>Stap voor stap</button><button aria-pressed={!lessonBuild} onClick={()=>{setLessonBuild(false);setNewlyRevealedId('')}}>Toon alles</button></div><button className="restart-build" onClick={startBuild}>Opnieuw beginnen ↺</button><span role="status">{building?`${events.length} van ${fullEvents.length} zichtbaar`:'Volledig overzicht'}</span></div>}
    {showDevelopment&&lesson&&<details className="development-note"><summary>{lesson.responsibility_development.title} <span>· overheid blijft regels stellen en toezicht houden</span></summary><p>{lesson.responsibility_development.summary} De lijn toont een redactionele ontwikkeling in nadruk, zonder één overdrachtsdatum.</p>{lesson.responsibility_development.sources.map(sid=><a key={sid} href={lesson.sources[sid].source_file?rawSourceUrl(lesson.sources[sid].source_file!):lesson.sources[sid].url} target="_blank" rel="noreferrer">{lesson.sources[sid].title} ↗</a>)}</details>}
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="timeline-caption"><span>{level==='major'?'Hoofdlijn':'Alle gebeurtenissen'} · gelijke kaartafstand</span><span>{events.length?index+1:0} / {events.length}</span></div>
    <div className="horizontal-track" ref={track} tabIndex={0} aria-label="Horizontale tijdlijn, gebruik de pijltoetsen om te navigeren" onKeyDown={e=>{if(e.key==='ArrowRight'){e.preventDefault();step(1)}if(e.key==='ArrowLeft'){e.preventDefault();step(-1)}}}>
      <div className="timeline-stage" style={{width:Math.max(events.length*235+90,700)}}>
        {showDevelopment&&lesson&&<div className="responsibility-rail" role="img" aria-label={`${visiblePhases.map(p=>p.label).join(' → ')}. Overheid blijft regels stellen en toezicht houden.`} style={{width:Math.max(0,events.length-1)*235}}>{visiblePhases.map(phase=>{
          const position=events.findIndex(e=>e.id===phase.event_id);
          return position<0?null:<span key={phase.event_id} className="responsibility-phase" style={{left:position*235}}><i/>{phase.label}</span>;
        })}</div>}
        <div className="timeline-spine" style={mode==='lesson'?{width:Math.max(0,events.length-1)*235}:{right:events.length?143:60}}/>
        {events.map((event,i)=>{
          const isLesson='year' in event;const year=isLesson?event.year:event.effective_date?.slice(0,4)||'?';
          const importance=eventLevel(event);
          const children=isLesson?lesson?.events.filter((e,j)=>(!building||j<=frontier)&&e.parent_event_id===event.id).length||0:0;
          const frontierCard=building&&i===events.length-1&&events.length<fullEvents.length;
          return <button key={event.id} data-event-id={event.id} data-importance={importance} data-impact={event.importance} className={`milestone ${i%2===0?'above':'below'} ${importance} ${activeId===event.id?'current':''} ${building&&event.id===newlyRevealedId?'just-revealed':''}`} style={{left:48+i*235}} onClick={()=>{select(event.id,!building);revealNext(event.id)}} aria-pressed={activeId===event.id} aria-label={`${year}: ${title(event)}`}>
            <span className="milestone-stem"/><span className="milestone-dot"/><span className="milestone-year">{year}</span>
            <span className="milestone-card">
              {importance!=='minor'&&<Illustration kind={isLesson?event.icon:'document'}/>}
              <span className="milestone-category">{isLesson?event.category:dateLabel(event.effective_date)}</span>
              <strong>{title(event)}</strong>
              {isLesson?<span className="milestone-summary">{event.summary}</span>:<>
                <span className="milestone-regulation">{event.regulation_name}</span>
                <span className="milestone-articles">{event.context||event.article_summary}</span>
                {event.context&&<span className="milestone-articles">{event.article_summary}</span>}
                {event.topics.length>1&&<span className="milestone-extra-topics">+ {event.topics.length-1} {event.topics.length===2?'onderwerp':'onderwerpen'}</span>}
              </>}
              {children>0&&<span className="child-count">{children} kleinere {children===1?'stap':'stappen'} ↗</span>}
              {importance==='minor'&&<span className="importance-label">{isLesson?'Kleinere stap':`${event.changed_article_count} ${event.changed_article_count===1?'artikel':'artikelen'} gewijzigd`}</span>}
              {frontierCard&&<span className="build-hint">Klik voor de volgende stap →</span>}
            </span>
          </button>;
        })}
      </div>
    </div>
    <div className="timeline-navigation"><button onClick={()=>step(-1)} disabled={!events.length||index===0} aria-label="Vorige gebeurtenis">← Vorige</button><div className="timeline-position">{events.map(e=><button key={e.id} className={activeId===e.id?'active':''} onClick={()=>select(e.id)} aria-label={`Ga naar ${title(e)}`} aria-pressed={activeId===e.id}/>)}</div><button onClick={()=>step(1)} disabled={!events.length||index===events.length-1&&(!building||events.length===fullEvents.length)} aria-label="Volgende gebeurtenis">Volgende →</button></div>
    {mode==='lesson'&&visibleIncidents.length>0&&<IncidentTimeline incidents={visibleIncidents} selectedId={selectedIncidentId} onSelect={id=>{setSelectedIncidentId(id);setShowAnswer(false)}}/>}
    <div ref={miniRegion} className="mini-region">
    {lessonSelected&&!activeIncident&&family.length>1&&<MiniTimeline title={`Binnen ${parent?.title}`} steps={family.map(e=>({id:e.id,label:e.date_precision==='year'?String(e.year):dateLabel(e.date),title:e.title,importance:e.importance,subtitle:e.id===parentId?'Hoofdmijlpaal':'Kleinere stap'}))} selectedId={lessonSelected.id} onSelect={select}/>}
    {lawSelected&&Boolean(lawSelected.mini_events?.length)&&<MiniTimeline title="Publicatie en inwerkingtreding" steps={lawSelected.mini_events.map(e=>({id:e.id,label:dateLabel(e.date),title:e.title,importance:e.kind==='effective'?'major':'minor',subtitle:e.publication_id}))} selectedId={selectedMiniId||lawSelected.id+'_effective'} onSelect={id=>{
      const event=lawSelected.mini_events.find(e=>e.id===id);setSelectedMiniId(id);
      if(event?.publication_id)onPublication(event.publication_id);
      else if(event?.kind==='effective'&&lawSelected.effective_date)onDate(lawSelected.effective_date);
    }}/>}
    </div>
    {lessonSelected&&<div className="timeline-detail" aria-live="polite"><div className="event-explanation">
      <div className="timeline-kicker">{lessonSelected.date_precision==='year'?lessonSelected.year:dateLabel(lessonSelected.date)} · {lessonSelected.date_kind}{activeIncident&&` · ${activeIncident.country}`}</div>
      {activeIncident?<p className="parent-route"><button onClick={()=>select(selected.id)}>Terug naar {title(selected)} ↑</button></p>:'importance' in lessonSelected&&lessonSelected.importance==='minor'&&<p className="parent-route">Kleinere stap binnen <button onClick={()=>select(parentId!)}>{parent?.title} ↑</button></p>}
      <h2>{lessonSelected.title}</h2>
      {lessonSelected.topics&&<div className="event-topics">{lessonSelected.topics.map(topic=><span key={topic}>{topic}</span>)}</div>}
      <p className="event-fact">{lessonSelected.fact}</p>
      <h3>{activeIncident?'Wat helpt dit incident bespreken?':'Wat verandert in het denken over veilig werk?'}</h3><p>{lessonSelected.meaning}</p>
      <div className="timeline-sources"><details><summary>Bronnen en datumcontrole</summary>
        {lessonSelected.sources.map(sid=>{const s=lesson!.sources[sid];return <div key={sid}><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a>{s.source_file?<a href={rawSourceUrl(s.source_file)} target="_blank" rel="noreferrer">Lokaal bronbestand ↗</a>:<small>Offline bron nog niet beschikbaar.</small>}</div>})}
        <p>Zekerheid historische kern: {lessonSelected.confidence==='high'?'hoog':'nader te beoordelen'}. Datumprecisie: {lessonSelected.date_precision==='year'?'jaar':'dag'}. De lesduiding en vragen zijn redactioneel.</p>
        {activeIncident?<p>Een geselecteerde incidentcasus voor de les. Een relatie met een wetswijziging wordt alleen genoemd waar de bron die ondersteunt.</p>:<p>Belang in dit lesverhaal: {'importance' in lessonSelected&&lessonSelected.importance==='major'?'grote mijlpaal':'kleinere stap'}. {'importance_reason' in lessonSelected&&lessonSelected.importance_reason} Dit is geen juridische impactclassificatie.</p>}
      </details></div>
      {lessonSelected.legal_refs?.length?<section className="lesson-article-routes" aria-label="Artikelroutes bij dit lesmoment"><h3>Verder kijken in de wet</h3><div>
        {lessonSelected.legal_refs.map(ref=><button key={`${ref.regulation_id}-${ref.article}-${ref.date||'current'}`} onClick={()=>openLessonArticle(ref)}>
          <strong>{ref.label} →</strong><small>{ref.regulation_id==='BWBR0010346'?'Arbowet':'Arbobesluit'} · art. {ref.article} · {ref.date?dateLabel(ref.date):'huidige tekst'}</small>
        </button>)}
      </div></section>:lessonSelected.register_target&&<button className="open-register" onClick={()=>openLessonArticle(lessonSelected.register_target!)}>Bekijk de huidige wettelijke uitwerking →</button>}
    </div><div className="lesson-question"><span className="question-label">VRAAG VOOR DE GROEP</span><h3>{lessonSelected.question}</h3><button className="reveal-answer" onClick={()=>setShowAnswer(v=>!v)} aria-expanded={showAnswer}>{showAnswer?'Verberg docentantwoord':'Open docentantwoord'}</button>{showAnswer&&<div className="teacher-answer"><span>ANTWOORDRICHTING</span><p>{lessonSelected.answer}</p></div>}</div></div>}
    {lawSelected&&<div className="timeline-detail legal-event" aria-live="polite"><div className="event-explanation">
      <div className="timeline-kicker">{dateLabel(lawSelected.effective_date)} · {lawSelected.regulation_name} {lawSelected.context&&`· ${lawSelected.context}`}</div><h2>{title(lawSelected)}</h2>
      <div className="event-topics">{lawSelected.topics.map(topic=><span key={topic}>{topic}</span>)}</div>
      <p>{lawSelected.summary}</p>{lawSelected.detail&&<p>{lawSelected.detail}</p>}
      <h3>Betrokken artikelen</h3><p className="article-evidence-note">Artikelverwijzingen uit de officiële wijzigingshistorie en vergelijking van teksttoestanden.</p>
      <div className="affected-articles">{lawSelected.affected_articles.map(a=><button key={a.number} onClick={()=>onOpen(lawSelected.regulation_id,a.number,lawSelected.effective_date||undefined)} title={`${a.heading||'Artikel '+a.number} · ${a.evidence==='official_article_wti'?'officiële artikelhistorie':'afgeleid uit teksttoestanden'}`}>
        <strong>Art. {a.number}</strong>{a.heading&&<span>{a.heading}</span>}
      </button>)}</div>
      {!lawSelected.affected_articles.length&&<p>Geen artikelkoppeling beschikbaar voor deze gebeurtenis.</p>}
      <details className="subject-evidence"><summary>Onderwerp en bron controleren</summary><p>De korte labels zijn redactioneel en gebaseerd op de bronpublicaties. Ze beschrijven het onderwerp; juridische impact vraagt een afzonderlijke beoordeling.</p>
        {lawSelected.source_publications.map(p=><div key={p.id}><a href={`https://zoek.officielebekendmakingen.nl/${p.id}.html`} target="_blank" rel="noreferrer">{p.title} ↗</a>
          {p.metadata_source_file&&<a href={rawSourceUrl(p.metadata_source_file)} target="_blank" rel="noreferrer">Officiële titelmetadata offline ↗</a>}</div>)}
        {lawSelected.subject_sources.map(url=><a key={url} href={url} target="_blank" rel="noreferrer">Aanvullende bron ↗</a>)}
      </details>
      <p className="impact-status">{lawSelected.changed_article_count===null?'Geen vergelijkbare teksttoestanden voor deze ingangsdatum.':`${lawSelected.changed_article_count} artikelen met berekende wijzigingen in de hele regeling.`} {lawSelected.importance_reason}</p>
      <details className="extent-evidence"><summary>Hoe is de omvang bepaald?</summary><p>{lawSelected.extent_basis}</p></details>
      {lawSelected.change_count!==undefined&&<p>{lawSelected.change_count} berekende elementwijzigingen in de beschikbare toestanden.</p>}
      {lawSelected.notes.map((n,i)=><p className="notice" key={i}>{n}</p>)}
    </div><div className="event-publications"><h3>Wijzigingspublicatie</h3>
      {lawSelected.publication_ids.length?lawSelected.publication_ids.map(pid=><div key={pid}><a href={`https://zoek.officielebekendmakingen.nl/${pid}.html`} target="_blank" rel="noreferrer">{pid} ↗</a><button className="timeline-offline" onClick={()=>onPublication(pid)}>Offline publicatie {pid}</button></div>):<p>Geen publicatieverwijzing beschikbaar.</p>}
      <h3>Inwerkingtredingspublicatie</h3>{lawSelected.commencement_publication_ids.map(pid=><a key={pid} href={`https://zoek.officielebekendmakingen.nl/${pid}.html`} target="_blank" rel="noreferrer">{pid} ↗</a>)}
      <p className="muted">Een klik op de hoofdtijdlijn past de peildatum toe. Publicatiedatum en inwerkingtreding blijven afzonderlijke stappen.</p>
      {publicationError&&<p className="notice" role="status">{publicationError}</p>}
    </div></div>}
    {mode==='register'&&Boolean(law?.undated_events.length)&&<details className="undated-history"><summary>{law!.undated_events.length} WTI-gebeurtenissen zonder ingangsdatum</summary><p>De bron geeft bij deze gebeurtenissen geen ingangsdatum. Daarom staan ze buiten de chronologische lijn.</p>{law!.undated_events.map((event,i)=><div key={i}><strong>{event.effect||'Wijzigingsinformatie'}</strong>{[...new Set([...event.publication_ids,...event.commencement_publication_ids])].map(pid=><a key={pid} href={`https://zoek.officielebekendmakingen.nl/${pid}.html`} target="_blank" rel="noreferrer">{pid} ↗</a>)}{event.notes.map((note,j)=><p key={j}>{note}</p>)}</div>)}</details>}
    {mode==='lesson'&&<p className="timeline-endnote">Lesduiding en vragen zijn een werkversie voor lesdag 1. De historische kern is gekoppeld aan bronnen; juridische verdieping volgt in deel 2.</p>}
  </section>;
}
