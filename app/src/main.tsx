import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { diffWords } from 'diff';
import './style.css';
import Timeline from './Timeline';
import { appPath, rawSourceUrl } from './paths';

type Source = { file: string; url: string; sha256: string; retrieved_at: string; koop_hash_verified: boolean; bytes: number };
type Ref = { text: string; jci: string; url: string; regulation_id: string | null };
type Node = { key: string; lineage_id: string; lineage_status: string; version_id: string; type: string; number: string; heading: string; blocks: string[]; text: string; status: string; children: Node[]; references: Ref[]; media: unknown[]; source_effective_date: string | null; source_publication: string | null; source_locator: { xml_path: string; jci: string | null; stem_id: string | null; label_id: string | null } };
type State = { id: string; valid_from: string; valid_to: string; known_from: string; known_to: string; source: Source; article_count: number };
type Entry = { number: string; heading: string; status: string; path: { type: string; number: string; heading: string }[]; change_count: number };
type Wti = { effective_date: string | null; effect: string; publication_ids: string[]; commencement_publication_ids: string[]; notes: string[] };
type Regulation = { id: string; title: string; as_of: string; states: State[]; articles: Entry[]; historic_articles: string[]; current_state_id: string; coverage_from: string; manifest_hash_mismatches: number; regulation_events: Wti[] };
type Snapshot = { id: string; tree: Node; full_text: string; first_observed: string };
type Observation = State & { state_id: string; snapshot_id: string };
type Change = { id: string; element_key: string; type: string; number: string; effective_date: string; before: string; after: string; classification: string; operation: string; publication_ids: string[]; from_version_id: string; to_version_id: string };
type Fragment = { id: string; publication_id: string; heading: string; blocks: string[]; text: string; source_anchor: string; source_file: string; targets: { regulation_id: string; article: string; element_key?: string; element_version_id: string; effective_date: string; mapping_method: string; status: string; reason?: string }[] };
type Article = { number: string; regulation_id: string; snapshots: Snapshot[]; observations: Observation[]; changes: Change[]; wti_events: Wti[]; explanations: Fragment[] };
type SearchEntry = { regulation_id: string; number: string; heading: string; text: string; status: string };
type Dataset = { as_of: string; regulations: { id: string; title: string; article_count: number; state_count: number; coverage_from: string }[]; publications_downloaded: number; publications_total: number; explanations_mapped: number; lineage_reviews: number; limitations: string[] };

const fetchJson = async <T,>(path: string): Promise<T> => {
  const response = await fetch(appPath(path));
  if (!response.ok) throw new Error(`Bestand niet beschikbaar: ${path} (${response.status})`);
  return response.json();
};
const labels: Record<string,string> = {chapter:'Hoofdstuk',section:'Afdeling',paragraph:'Paragraaf',subsection:'Subparagraaf',article:'Artikel',member:'Lid',item:'Onderdeel'};
const niceDate = (s: string | null) => s ? new Intl.DateTimeFormat('nl-NL', { day:'numeric', month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(s+'T12:00:00Z')) : 'Datum niet vastgesteld';
const rawUrl = rawSourceUrl;
const pubUrl = (pid: string) => `https://zoek.officielebekendmakingen.nl/${pid}.html`;
const allNodes = (n: Node): Node[] => [n, ...n.children.flatMap(allNodes)];
const nodeText = (n: Node): string => [...(['member','item'].includes(n.type)?[n.number.replace(/\.$/,'')+'.']:[]), ...n.blocks, ...n.children.map(nodeText)].join('\n\n').trim();
const referenceUrl = (jci: string, day: string, known: string) => 'https://wetten.overheid.nl/' + jci.replace(/^https?:\/\/wetten.overheid.nl\//,'').replace(/&[gz]=[^&]*/g,'') + `&g=${day}&z=${known}`;
const observationAt = (a: Article, day: string, known: string) => a.observations.find(o => o.valid_from <= day && day <= o.valid_to && o.known_from <= known && known <= o.known_to);
const snapshotAt = (a: Article, day: string, known: string) => {
  const o = observationAt(a, day, known);
  return a.snapshots.find(s => s.id === o?.snapshot_id);
};

function Provision({ node, selected, onSelect }: { node: Node; selected: string; onSelect: (key:string)=>void }) {
  return <section className={`provision ${selected===node.key?'selected':''} ${node.type}`} id={'node-'+node.key.replace(/[^a-zA-Z0-9]/g,'-')}>
    {node.type!=='article' && <button className="node-label" onClick={()=>onSelect(node.key)}>{labels[node.type]} {node.number.replace(/\.$/,'')} <span>Bekijk context ↗</span></button>}
    {node.blocks.map((block,i)=><p key={i}>{block}</p>)}
    {node.media.length>0 && <p className="notice">Deze bepaling bevat beeldmateriaal. Bekijk het lokale XML-bronbestand voor het complete origineel.</p>}
    {node.children.map(c=><Provision key={c.key} node={c} selected={selected} onSelect={onSelect}/>)}
  </section>;
}

const routeParams=new URLSearchParams(window.location.search);
const routeRid=['BWBR0010346','BWBR0008498'].includes(routeParams.get('regeling')||'')?routeParams.get('regeling')!:'';
const routeArticle=/^\d+(\.\d+)?[a-z]?$/i.test(routeParams.get('artikel')||'')?routeParams.get('artikel')!:'';
const requestedDate=routeParams.get('datum')||'';
const routeDate=/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)&&!Number.isNaN(Date.parse(requestedDate))&&new Date(requestedDate).toISOString().slice(0,10)===requestedDate?requestedDate:undefined;
function App() {
  const [view,setView]=useState<'lesson'|'register'>(routeRid?'register':'lesson');
  const [dataset,setDataset]=useState<Dataset>();
  const [regulation,setRegulation]=useState<Regulation>();
  const [rid,setRid]=useState(routeRid||'BWBR0010346');
  const [number,setNumber]=useState(routeArticle||(routeRid==='BWBR0008498'?'2.5':'5'));
  const [article,setArticle]=useState<Article>();
  const [selected,setSelected]=useState('');
  const [day,setDay]=useState(routeDate||'2026-10-05');
  const [query,setQuery]=useState('');
  const [search,setSearch]=useState<SearchEntry[]>([]);
  const [showExpired,setShowExpired]=useState(false);
  const [tab,setTab]=useState('Toelichting');
  const [error,setError]=useState('');
  const [compareFrom,setCompareFrom]=useState('');
  const [compareTo,setCompareTo]=useState('');
  const [showDiff,setShowDiff]=useState(false);
  const [diffMode,setDiffMode]=useState('inline');
  const [allChanges,setAllChanges]=useState(false);
  const [publication,setPublication]=useState<{ id:string; title:string; full_text:string; source:Source }>();
  const [publicationError,setPublicationError]=useState('');
  useEffect(()=>{ fetchJson<Dataset>('/data/index.json').then(setDataset).catch(e=>setError(e.message)); },[]);
  useEffect(()=>{
    let cancelled=false; setRegulation(undefined);setArticle(undefined);setError('');
    fetchJson<Regulation>(`/data/regulations/${rid}/index.json`).then(v=>{if(!cancelled)setRegulation(v)}).catch(e=>{if(!cancelled)setError(e.message)});
    return ()=>{cancelled=true};
  },[rid]);
  useEffect(()=>{
    let cancelled=false;setArticle(undefined);setShowDiff(false);
    fetchJson<Article>(`/data/regulations/${rid}/articles/${encodeURIComponent(number)}.json`).then(a=>{
      if(cancelled)return;setArticle(a);const s=snapshotAt(a,day,dataset?.as_of||'2026-10-05');
      setSelected(s?.tree.key||'');setCompareTo(day);
      const changes=a.changes.filter(c=>c.effective_date<=day);
      const last=changes.at(-1);const before=last?a.snapshots.find(x=>x.id===last.from_version_id):a.snapshots[0];
      setCompareFrom(before?.first_observed||day);
    }).catch(e=>{if(!cancelled)setError(e.message)});
    return ()=>{cancelled=true};
  },[rid,number]);
  useEffect(()=>{
    if(query && !search.length)fetchJson<SearchEntry[]>('/data/search-index.json').then(setSearch).catch(e=>setError(e.message));
  },[query]);
  const known=dataset?.as_of||'2026-10-05';
  const state=regulation?.states.find(s=>s.valid_from<=day&&day<=s.valid_to&&s.known_from<=known&&known<=s.known_to);
  const snapshot=article&&snapshotAt(article,day,known);
  const observation=article&&observationAt(article,day,known);
  const selectedNode=snapshot&&(allNodes(snapshot.tree).find(n=>n.key===selected)||snapshot.tree);
  const switchRegulation=(id:string)=>{setRid(id);setNumber(id==='BWBR0010346'?'5':'2.5');setQuery('');setSelected('');};
  const entries=regulation?.articles.filter(e=>showExpired||e.status!=='vervallen')||[];
  const hits=query.trim()?search.filter(e=>e.regulation_id===rid&&(showExpired||e.status!=='vervallen')&&`${e.number} ${e.heading} ${e.text}`.toLocaleLowerCase('nl').includes(query.trim().toLocaleLowerCase('nl'))).slice(0,80):[];
  const availableExplanations=article?.explanations.filter(f=>f.targets.some(t=>t.regulation_id===rid && t.effective_date<=day))||[];
  const fragments=availableExplanations.filter(f=>f.targets.some(t=>t.regulation_id===rid&&(!t.element_key||selectedNode?.key===t.element_key)));
  const changes=(article?.changes||[]).filter(c=>(allChanges||c.classification!=='structural')&&(!selectedNode||selectedNode.type==='article'||c.element_key===selectedNode.key));
  const refs=selectedNode?allNodes(selectedNode).flatMap(n=>n.references):[];
  const uniqueRefs=[...new Map(refs.map(r=>[r.jci,r])).values()];
  const left=article&&snapshotAt(article,compareFrom,known),right=article&&snapshotAt(article,compareTo,known);
  const compareText=(s:Snapshot|undefined)=>{if(!s)return '';if(!selectedNode||selectedNode.type==='article')return s.full_text;const node=allNodes(s.tree).find(n=>n.key===selectedNode.key);return node?nodeText(node):''};
  const openPublication=async(pid:string)=>{
    setPublicationError('');try{setPublication(await fetchJson(`/data/publications/${pid}.json`))}catch{setPublicationError(`${pid} is nog niet offline opgehaald. De officiële online publicatie is via de bronlink beschikbaar.`)}
  };
  return <>
    <header><div className="brand">V<span>VaultTek</span></div><div className="brand-title">Juridisch register <span>Arbeidsomstandigheden</span></div><div className="view-switch"><button aria-pressed={view==='lesson'} onClick={()=>setView('lesson')}>Tijdlijn · lesdag 1</button><button aria-pressed={view==='register'} onClick={()=>setView('register')}>Wetgeving & historie</button></div><div className="local">● Juridisch register <small>Broncontrole {niceDate(dataset?.as_of||null)}</small></div></header>
    {view==='register'&&<nav className="regulations" aria-label="Regelingen">{dataset?.regulations.map(r=><button key={r.id} aria-pressed={rid===r.id} onClick={()=>switchRegulation(r.id)}>{r.title}<small>{r.article_count} artikelen · {r.state_count} toestanden</small></button>)}<div className="reg-note">Officiële tekst, geschiedenis en toelichting op één plek.</div></nav>}
    <Timeline mode={view} regulationId={rid} articleNumber={number} initialDate={routeDate} onDate={setDay} onPublication={openPublication} publicationError={publicationError} onOpen={(id,n,date)=>{setRid(id);setNumber(n);setDay(date||known);setView('register');setSelected('');setQuery('')}}/>
    {error&&<div className="error" role="alert">{error}</div>}
    {view==='register'&&<div className="workspace">
      <aside className="navigation"><label className="search">Zoek binnen deze regeling<input placeholder="Artikel, onderwerp of tekst…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        <div className="nav-heading">Inhoud <label><input type="checkbox" checked={showExpired} onChange={e=>setShowExpired(e.target.checked)}/> ook vervallen</label></div>
        <div className="article-list">
          {query.trim()?<><p className="search-count">{hits.length} resultaten{hits.length===80?' (maximaal 80 getoond)':''} · tekst bij broncontrole</p>{hits.map(e=><button className={number===e.number?'active':''} key={e.number} onClick={()=>setNumber(e.number)}><strong>Artikel {e.number}</strong><span>{e.heading||e.text.slice(0,95)+'…'}</span></button>)}{!hits.length&&<p className="muted">Geen resultaten.</p>}</>:
            entries.map((e,i)=>{const chapter=e.path.find(p=>p.type==='chapter');const prev=entries[i-1]?.path.find(p=>p.type==='chapter');return <React.Fragment key={e.number}>
              {chapter?.number!==prev?.number&&<h3>Hoofdstuk {chapter?.number}<span>{chapter?.heading}</span></h3>}
              <button className={number===e.number?'active':''} onClick={()=>setNumber(e.number)}><strong>Artikel {e.number}{e.status==='vervallen'?' · vervallen':''}</strong><span>{e.heading||e.path.filter(p=>p.type==='paragraph').at(-1)?.heading}</span></button>
            </React.Fragment>})}
        </div><div className="coverage">Historische tekst vanaf <strong>{niceDate(regulation?.coverage_from||null)}</strong>. Eerdere WTI-gebeurtenissen kunnen wel zichtbaar zijn.</div>
      </aside>
      <main><div className="article-top"><div className="eyebrow">{regulation?.id} / ARTIKEL {number}</div><label className="date">Geldig op<input aria-label="Peildatum" type="date" value={day} min={regulation?.coverage_from} max={known} onChange={e=>setDay(e.target.value)}/></label></div>
        <h1>Artikel {number}</h1><h2>{snapshot?.tree.heading||entries.find(e=>e.number===number)?.path.filter(p=>p.type==='paragraph').at(-1)?.heading||regulation?.title}</h2>
        <div className="metadata"><span className="badge official">OFFICIËLE BRONTEKST</span>{!snapshot?<span className="badge">TEKST NIET BESCHIKBAAR</span>:snapshot.tree.status==='vervallen'?<span className="badge">VERVALLEN</span>:<span className="badge subtle">GELDEND OP {day}</span>}<span>Toestand {state?.id||'niet beschikbaar'}</span></div>
        {snapshot?.tree.source_effective_date&&<p className="muted">Inwerkingtreding artikel volgens XML: {niceDate(snapshot.tree.source_effective_date)}.</p>}
        <div className="tools"><button onClick={()=>{setTab('Historie');setShowDiff(v=>!v)}}>{showDiff?'Sluit vergelijking':'Vergelijk teksten'}</button><button onClick={()=>{if(snapshot)setSelected(snapshot.tree.key);setTab('Toelichting')}}>Context van het hele artikel</button><a href={referenceUrl(`jci1.3:c:${rid}&artikel=${number}`,day,known)} target="_blank" rel="noreferrer">Open op wetten.nl ↗</a></div>
        {showDiff&&<section className="comparison"><h3>Tekstvergelijking {selectedNode?.type!=='article'?`${labels[selectedNode?.type||'']} ${selectedNode?.number}`:''}</h3><div className="compare-inputs"><label>Van<input aria-label="Vergelijken vanaf" type="date" min={regulation?.coverage_from} max={known} value={compareFrom} onChange={e=>setCompareFrom(e.target.value)}/></label><label>Naar<input aria-label="Vergelijken tot" type="date" min={regulation?.coverage_from} max={known} value={compareTo} onChange={e=>setCompareTo(e.target.value)}/></label><select aria-label="Diffweergave" value={diffMode} onChange={e=>setDiffMode(e.target.value)}><option value="inline">In de tekst</option><option value="columns">Naast elkaar</option></select></div>
          {!left||!right?<p className="notice">Voor één van deze datums is geen artikeltekst beschikbaar in de opgehaalde toestanden.</p>:diffMode==='columns'?<div className="diff-columns"><div><h4>{niceDate(compareFrom)}</h4><p>{compareText(left)}</p></div><div><h4>{niceDate(compareTo)}</h4><p>{compareText(right)}</p></div></div>:<><p className="diff-legend"><del>verwijderd</del> <ins>toegevoegd</ins></p><div className="diff">{diffWords(compareText(left),compareText(right)).map((p,i)=>p.added?<ins key={i}>{p.value}</ins>:p.removed?<del key={i}>{p.value}</del>:<span key={i}>{p.value}</span>)}</div>{compareText(left)===compareText(right)&&<p className="notice">Geen tekstverschil tussen deze datums.</p>}</>}
        </section>}
        <div className="legal-text">{article?snapshot?<Provision node={snapshot.tree} selected={selectedNode?.key||''} onSelect={setSelected}/>:<p className="notice">Dit artikel is op deze peildatum niet in de beschikbare toestand opgenomen.</p>:<p>Artikel laden…</p>}</div>
        <footer className="article-foot">De tekst is uit KOOP-XML geëxtraheerd. Structuur en opmaak zijn afgeleid. Bronbestanden blijven lokaal beschikbaar.</footer>
      </main>
      <aside className="context"><div className="context-title">Context <strong>{labels[selectedNode?.type||'article']} {selectedNode?.number||number}</strong></div>
        <div className="tabs" role="tablist">{['Toelichting','Historie','Relaties','Bron'].map(t=><button role="tab" aria-selected={t===tab} key={t} onClick={()=>setTab(t)}>{t}</button>)}</div>
        <div className="context-body">
          {tab==='Toelichting'&&<>{!fragments.length&&<div className="empty"><h3>Geen gekoppelde passage beschikbaar</h3><p>Voor deze selectie is nog geen toelichtingsfragment gekoppeld. Dit zegt niets over het bestaan van een officiële toelichting.</p></div>}{fragments.map(f=>{const target=f.targets.find(t=>t.regulation_id===rid)!;const exact=target.element_version_id===snapshot?.id;return <article className="explanation" key={f.id}><span className="badge official">OFFICIËLE TOELICHTING</span><h3>{f.heading}</h3><a href={pubUrl(f.publication_id)} target="_blank" rel="noreferrer">{f.publication_id} ↗</a><p className="mapping"><strong>{target.mapping_method==='ai'?'AI gekoppeld':'Afgeleide koppeling'}</strong> · {target.element_key?'deze bepaling':'artikel als geheel'}<br/>Wijziging per {niceDate(target.effective_date)}{!exact&&<><br/>Historische toelichting; toepassing op deze versie niet opnieuw vastgesteld.</>}</p>{target.reason&&<p className="muted">{target.reason}</p>}{f.blocks.map((b,i)=><p key={i}>{b}</p>)}<details><summary>Herleidbaarheid van de passage</summary><code>{f.source_anchor}</code><a href={rawUrl(f.source_file)} target="_blank" rel="noreferrer">Lokaal publicatiebestand ↗</a></details><button onClick={()=>openPublication(f.publication_id)}>Volledige publicatie offline</button></article>})}</>}
          {tab==='Historie'&&<><p className="notice">Tekstwijzigingen zijn berekend. De inhoudelijke classificatie is nog niet beoordeeld; onbekende wijzigingen blijven zichtbaar.</p><label className="check"><input type="checkbox" checked={allChanges} onChange={e=>setAllChanges(e.target.checked)}/> Toon ook structurele wijzigingen</label><h3>Tekstwijzigingen · {changes.length}</h3><div className="timeline">{[...changes].reverse().map(c=><div className="event" key={c.id}><time>{niceDate(c.effective_date)}</time><strong>{labels[c.type]} {c.number} · {c.operation==='modified'?'gewijzigd':c.operation==='added'?'toegevoegd':'verwijderd'}</strong><span className="badge subtle">{c.classification==='unknown'?'NOG TE BEOORDELEN':'STRUCTUREEL'}</span><button onClick={()=>{const before=article?.snapshots.find(s=>s.id===c.from_version_id);setCompareFrom(before?.first_observed||'');setCompareTo(c.effective_date);setShowDiff(true)}}>Bekijk verschil</button>{c.publication_ids.map(p=><a key={p} href={pubUrl(p)} target="_blank" rel="noreferrer">{p} ↗</a>)}</div>)}</div><h3>Officiële wijzigingshistorie (WTI)</h3>{[...(article?.wti_events||[])].sort((a,b)=>(b.effective_date||'').localeCompare(a.effective_date||'')).map((e,i)=><div className="wti" key={i}><strong>{niceDate(e.effective_date)}</strong><p>{e.effect}</p>{e.publication_ids.map(p=><div key={p}><a href={pubUrl(p)} target="_blank" rel="noreferrer">Wijzigingspublicatie {p} ↗</a><button className="text-button" onClick={()=>openPublication(p)}>Offline openen</button></div>)}{e.commencement_publication_ids.map(p=><div key={p}><a href={pubUrl(p)} target="_blank" rel="noreferrer">Inwerkingtreding {p} ↗</a></div>)}{e.notes.map((n,i)=><p className="notice" key={i}>{n}</p>)}</div>)}</>}
          {tab==='Relaties'&&<><span className="badge official">VERWIJZINGEN UIT XML</span><h3>{uniqueRefs.length} verwijzingen</h3>{uniqueRefs.map((r,i)=><div className="relation" key={i}><a href={referenceUrl(r.jci,day,known)} target="_blank" rel="noreferrer">{r.text} ↗</a><small>{r.regulation_id}</small>{r.regulation_id&&['BWBR0010346','BWBR0008498'].includes(r.regulation_id)&&r.jci.match(/&artikel=([^&]+)/)&&<button onClick={()=>{const n=r.jci.match(/&artikel=([^&]+)/)![1];setRid(r.regulation_id!);setNumber(n);setSelected('');setQuery('')}}>Bekijk in register</button>}</div>)}{selectedNode&&<p className="notice">Identiteit: {selectedNode.lineage_status==='source_stem'?'officieel stam-ID uit de bron':'positie in de bron; inhoudelijke continuïteit nog niet bevestigd'}. Splitsing en samenvoeging worden nog niet automatisch vastgesteld.</p>}</>}
          {tab==='Bron'&&<><h3>Controleerbare bronroute</h3><dl><dt>Bron</dt><dd>Basiswettenbestand / KOOP</dd><dt>Geldigheidsperiode toestand</dt><dd>{niceDate(state?.valid_from||null)} → {state?.valid_to==='9999-12-31'?'geen einddatum geregistreerd':niceDate(state?.valid_to||null)}</dd><dt>Zichtperiode toestand</dt><dd>{niceDate(state?.known_from||null)} → {state?.known_to==='9999-12-31'?'open':niceDate(state?.known_to||null)}</dd><dt>Opgehaald</dt><dd>{observation?.source.retrieved_at}</dd><dt>SHA-256 lokaal bestand</dt><dd><code>{observation?.source.sha256}</code></dd><dt>XML-locator selectie</dt><dd><code>{selectedNode?.source_locator.xml_path}</code></dd></dl>{observation&&<><a className="button-link" href={rawUrl(observation.source.file)} target="_blank" rel="noreferrer">Open lokaal XML-bronbestand ↗</a><a className="button-link" href={observation.source.url} target="_blank" rel="noreferrer">Open officiële repository ↗</a></>}<p className="notice">{regulation?.manifest_hash_mismatches} manifesthashes komen niet overeen met de geleverde XML. De betekenis van dit verschil is nog niet vastgesteld. Lokale checksums en XML-identiteit worden wel gecontroleerd.</p><h3>Dekking van deze bouwversie</h3><p>{dataset?.publications_downloaded} volledige publicaties offline; {dataset?.publications_total} publicatieverwijzingen uit WTI.</p><p>{dataset?.explanations_mapped} gekoppelde artikel- en lidpassages. {dataset?.lineage_reviews} structurele identiteitsvragen in de reviewlijst.</p></>}
          {publicationError&&<p className="notice" role="status">{publicationError}</p>}
        </div>
      </aside>
    </div>}
    {publication&&<div className="modal-backdrop" onClick={()=>setPublication(undefined)}><section role="dialog" aria-modal="true" aria-label="Offline publicatie" className="publication-modal" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setPublication(undefined)}>Sluiten ×</button><div className="eyebrow">OFFICIËLE PUBLICATIE · {publication.id}</div><h2>{publication.title}</h2><a href={rawUrl(publication.source.file)} target="_blank" rel="noreferrer">Lokaal origineel XML ↗</a><p>{publication.full_text}</p></section></div>}
  </>;
}
createRoot(document.getElementById('root')!).render(<App/>);
