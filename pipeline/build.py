"""Build the file-based register from immutable KOOP XML; no network needed."""
from __future__ import annotations
from collections import Counter
import copy
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from download import ROOT, REGULATIONS

AS_OF = "2026-10-05"  # Explicit research/build date; never the host's implicit date.
STRUCTURE = {"hoofdstuk": "chapter", "afdeling": "section", "paragraaf": "paragraph",
             "sub-paragraaf": "subsection", "artikel": "article", "lid": "member", "li": "item"}
IGNORE = {"meta-data", "kop", "lidnr", "li.nr"}

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")

def text(element):
    if element is None:
        return ""
    return re.sub(r"\s+", " ", "".join(element.itertext())).strip()

def official_url(jci):
    return "https://wetten.overheid.nl/" + jci.replace("http://wetten.overheid.nl/", "").replace("https://wetten.overheid.nl/", "")

def own_content(el):
    """Read legal text while excluding child provisions and injected KOOP metadata."""
    blocks, references, media = [], [], []
    def walk(node):
        for c in node:
            if c.tag in IGNORE or c.tag in STRUCTURE:
                continue
            if c.tag in {"al", "tussenkop", "table", "tabel", "formule", "plaatje", "illustratie"}:
                if c.tag in {"table", "tabel"}:
                    rows = [" | ".join(text(cell) for cell in row if cell.tag in {"entry", "td", "th"}) for row in c.iter() if row.tag in {"row", "tr"}]
                    blocks.append("\n".join(rows) if rows else text(c))
                else:
                    blocks.append(text(c))
                references.extend({"text": text(r), "jci": r.get("doc", ""), "url": official_url(r.get("doc", "")),
                                   "regulation_id": r.get("bwb-id"), "source_label_id": r.get("label-id")}
                                  for r in c.iter() if r.tag in {"intref", "extref"} and r.get("doc", "").startswith("jci"))
                media.extend(dict(m.attrib) for m in c.iter() if m.tag in {"plaatje", "illustratie", "img"})
            else:
                walk(c)
    walk(el)
    return [b for b in blocks if b], references, media

def parse_tree(el, rid, state_label, source, ancestor_lineage="", parent_key=None, article_number=None):
    kind = STRUCTURE[el.tag]
    locator = el.get("bwb-ng-variabel-deel", "")
    number = el.findtext("kop/nr") or el.findtext("lidnr") or el.findtext("li.nr") or ""
    if not number and kind == "article":
        number = el.get("label", "").removeprefix("Artikel ") or locator.rsplit("Artikel", 1)[-1]
    if kind == "article":
        article_number = number
    stem = el.get("stam-id")
    lineage = f"lin_{rid}_{stem}" if stem else ancestor_lineage + ":" + locator.split("/Artikel")[-1]
    if not lineage:
        lineage = f"lin_{rid}_" + digest(locator)[:16]
    key = el.get("label-id") or locator
    blocks, references, media = own_content(el)
    node = {"key": key, "lineage_id": lineage, "lineage_status": "source_stem" if stem else "positional_candidate",
            "version_id": f"ev_{rid}_{state_label}_" + digest(locator)[:16], "parent_key": parent_key,
            "type": kind, "number": number, "heading": text(el.find("kop/titel")),
            "blocks": blocks, "text": "\n\n".join(blocks), "references": references, "media": media,
            "source_locator": {"regulation_id": rid, "state": state_label, "xml_path": locator,
                               "label_id": el.get("label-id"), "stem_id": stem, "source_version_id": el.get("versie-id"),
                               "jci": (el.find("meta-data/jcis/jci").get("verwijzing") if el.find("meta-data/jcis/jci") is not None else None)},
            "source_effective_date": el.get("inwerking"), "source_publication_date": el.get("publicatie_bron"),
            "source_publication": el.get("bron"), "status": el.get("status", "goed"),
            "article_number": article_number, "children": []}
    def children(container):
        for c in container:
            if c.tag in STRUCTURE:
                node["children"].append(parse_tree(c, rid, state_label, source, lineage, key, article_number))
            elif c.tag not in IGNORE and c.tag not in {"al", "table", "tabel"}:
                children(c)
    children(el)
    return node

def flatten(node):
    yield node
    for child in node["children"]:
        yield from flatten(child)

def full_text(node):
    own = ([node["number"].rstrip(".") + "."] if node["type"] in {"member", "item"} else []) + node["blocks"]
    return "\n\n".join(own + [full_text(c) for c in node["children"]]).strip()

def semantic_tree(node):
    return {k: node[k] for k in ("key", "lineage_id", "type", "number", "heading", "blocks", "status", "media")} | {
        "references": [{"text": r['text'], "target": re.sub(r'&[gz]=[^&]*', '', r['jci'])} for r in node['references']],
        "children": [semantic_tree(c) for c in node["children"]]}

def parse_wti(source):
    root = ET.parse(ROOT / source["file"]).getroot()
    element_events, publications = {}, {}
    def events(container):
        result = []
        for day in container.findall("datum"):
            for detail in day.findall("details"):
                origins, commencement = [], []
                for part, output in (("ontstaansbron", origins), ("inwerkingtreding", commencement)):
                    for pub in detail.findall(f"{part}/bron/bekendmaking"):
                        pid = pub.get("urlidentifier")
                        if not pid:
                            continue
                        publications[pid] = {"id": pid, "publication_type": pub.get("soort"),
                                             "publication_date": pub.findtext("publicatiedatum"),
                                             "url": f"https://zoek.officielebekendmakingen.nl/{pid}.html"}
                        output.append(pid)
                result.append({"effective_date": day.get("waarde"), "label": day.get("label"),
                               "source_version_id": day.get("versie-id"), "effect": detail.findtext("betreft"),
                               "publication_ids": origins, "commencement_publication_ids": commencement,
                               "notes": [text(n) for n in detail.findall("opmerkingen/opmerking")],
                               "source_file": source["file"], "origin": "official"})
        return result
    for item in root.findall("wijzigingen/regelingelementen/regelingelement"):
        element_events[item.get("label-id")] = events(item)
    regulation_events = events(root.find("wijzigingen/regeling"))
    return element_events, regulation_events, publications

def build_regulation(rid):
    source_index = json.loads((ROOT / "data/source-index" / (rid + ".json")).read_text())
    wti_events, regulation_events, publications = parse_wti(source_index["wti"])
    states = sorted(source_index["states"], key=lambda s: (s["datum_inwerkingtreding"], s["zichtdatum_start"]))
    visible = [s for s in states if s["zichtdatum_start"] <= AS_OF <= s["zichtdatum_eind"]]
    articles, state_rows = {}, []
    for s in states:
        raw = ET.parse(ROOT / s["source"]["file"]).getroot()
        assert raw.get("bwb-id") == rid, f"Wrong source identity: {s['source']['file']}"
        assert raw.get("inwerkingtreding") == s["datum_inwerkingtreding"]
        wettekst = raw.find("wetgeving/wet-besluit/wettekst")
        assert wettekst is not None
        roots = [parse_tree(c, rid, s["label"], s["source"]) for c in wettekst if c.tag in STRUCTURE]
        nodes = [n for root in roots for n in flatten(root)]
        node_lookup = {n['key']: n for n in nodes}
        keys = [n["key"] for n in nodes]
        assert len(keys) == len(set(keys)), f"Duplicate element key in {rid} {s['label']}"
        state = {"id": s["label"], "valid_from": s["datum_inwerkingtreding"], "valid_to": s["einddatum"],
                 "known_from": s["zichtdatum_start"], "known_to": s["zichtdatum_eind"],
                 "source": s["source"], "article_count": sum(n["type"] == "article" for n in nodes)}
        state_rows.append(state)
        write_json(ROOT / "data/normalized/states" / rid / (s["label"] + ".json"), {"state": state, "tree": roots})
        # Store observed article versions independently of their coordinate/lineage.
        for n in nodes:
            if n["type"] != "article":
                continue
            number = n["number"]
            a = articles.setdefault(number, {"regulation_id": rid, "number": number, "snapshots": [], "observations": [], "changes": [], "explanations": [], "wti_events": []})
            h = digest(semantic_tree(n))
            snap = next((x for x in a["snapshots"] if x["content_hash"] == h and x["tree"]["lineage_id"] == n["lineage_id"]), None)
            if snap is None:
                snap = {"id": n["version_id"], "content_hash": h, "tree": n, "full_text": full_text(n), "first_observed": state["valid_from"]}
                a["snapshots"].append(snap)
            ancestors, parent_key = [], n['parent_key']
            while parent_key:
                parent = node_lookup[parent_key]
                ancestors.insert(0, {k: parent[k] for k in ('type', 'number', 'heading')})
                parent_key = parent['parent_key']
            a["observations"].append({"state_id": state["id"], "snapshot_id": snap["id"], "source": s["source"], "path": ancestors,
                                      "valid_from": state["valid_from"], "valid_to": state["valid_to"], "known_from": state["known_from"], "known_to": state["known_to"]})
            for event in wti_events.get(n["source_locator"]["label_id"], []):
                if event not in a["wti_events"]:
                    a["wti_events"].append(event)
    review = []
    for number, a in articles.items():
        observations = [o for o in a["observations"] if o["known_from"] <= AS_OF <= o["known_to"]]
        snapshots = {x["id"]: x for x in a["snapshots"]}
        previous = None
        for o in observations:
            now = snapshots[o["snapshot_id"]]
            if previous and previous["id"] != now["id"]:
                old_nodes = {n["key"]: n for n in flatten(previous["tree"])}
                new_nodes = {n["key"]: n for n in flatten(now["tree"])}
                for key in sorted(set(old_nodes) | set(new_nodes)):
                    before, after = old_nodes.get(key), new_nodes.get(key)
                    old_text, new_text = (before or {}).get("text", ""), (after or {}).get("text", "")
                    if before and after and all(before[k] == after[k] for k in ("text", "heading", "number", "status", "lineage_id")):
                        continue
                    category = "unknown"
                    if before and after and old_text == new_text and before['status'] == after['status']:
                        category = "structural"
                    change = {"id": "chg_" + digest([rid, number, key, o["state_id"]])[:20], "element_key": key,
                              "lineage_id": (after or before)["lineage_id"], "type": (after or before)["type"],
                              "number": (after or before)["number"], "effective_date": o["valid_from"],
                              "from_version_id": previous["id"], "to_version_id": now["id"],
                              "operation": "added" if before is None else "removed" if after is None else "modified",
                              "classification": category, "classification_confidence": None,
                              "before": old_text, "after": new_text, "origin": "derived",
                              "lineage_status": (after or before)["lineage_status"],
                              "publication_ids": sorted({pid for ev in a["wti_events"] if ev["effective_date"] == o["valid_from"] for pid in ev["publication_ids"]})}
                    a["changes"].append(change)
                # Positional identities need human/AI review after member insertion/deletion or replacement.
                if previous["tree"]["lineage_id"] != now["tree"]["lineage_id"] or set(old_nodes) != set(new_nodes):
                    review.append({"regulation_id": rid, "article": number, "date": o["valid_from"], "status": "needs_review",
                                   "reason": "Different stem identity or changed member/item structure; no semantic lineage asserted.",
                                   "from_version_id": previous["id"], "to_version_id": now["id"]})
            previous = now
    current = next((s for s in reversed(state_rows) if s["valid_from"] <= AS_OF <= s["valid_to"] and s["known_from"] <= AS_OF <= s["known_to"]), None)
    assert current, f"No state covers {AS_OF}"
    current_data = json.loads((ROOT / "data/normalized/states" / rid / (current["id"] + ".json")).read_text())
    current_nodes = [n for root in current_data["tree"] for n in flatten(root)]
    index_articles = []
    for n in current_nodes:
        if n["type"] == "article":
            ancestors = []
            key = n["parent_key"]
            lookup = {x["key"]: x for x in current_nodes}
            while key:
                parent = lookup[key]
                ancestors.insert(0, {"type": parent["type"], "number": parent["number"], "heading": parent["heading"]})
                key = parent["parent_key"]
            index_articles.append({"number": n["number"], "heading": n["heading"], "status": n["status"], "path": ancestors,
                                   "change_count": len(articles[n["number"]]["changes"])})
    info = {"id": rid, "title": REGULATIONS[rid], "as_of": AS_OF, "states": state_rows, "current_state_id": current["id"],
            "articles": index_articles, "historic_articles": [n for n in articles if n not in {x['number'] for x in index_articles}],
            "coverage_from": min(s["datum_inwerkingtreding"] for s in visible), "coverage_to": current["valid_to"],
            "state_count": len(states), "history_complete_since_enactment": False,
            "manifest_generated": source_index["manifest_generated"], "regulation_events": regulation_events,
            "manifest_hash_mismatches": sum(not s["source"]["koop_hash_verified"] for s in states),
            "source_assurance": "official_repository_xml_local_checksums_manifest_hash_unresolved",
            "annexes": [{"heading": text(b.find('kop')), "text": text(b)} for b in current_data.get('annexes', [])]}
    return info, articles, publications, review

def publication_fragments(pid, source):
    root = ET.parse(ROOT / source["file"]).getroot()
    fragments = []
    paths = {}
    def register(el, path):
        paths[id(el)] = path
        counts = Counter()
        for c in el:
            counts[c.tag] += 1
            register(c, f"{path}/{c.tag}[{counts[c.tag]}]")
    register(root, f"/{root.tag}[1]")
    for explanation in root.findall('.//nota-toelichting'):
        for d in explanation.findall('.//divisie'):
            heading = text(d.find('kop'))
            match = re.match(r"Artikel\s+(\d+(?:\.\d+)*[a-z]*)\.(?:\s|$)", heading)
            if not match:
                continue
            paragraphs = [text(a) for a in d.findall('.//al')]
            fragments.append({"id": "exp_" + digest([pid, paths[id(d)]])[:20], "publication_id": pid,
                              "heading": heading, "blocks": paragraphs, "text": '\n\n'.join(paragraphs),
                              "source_anchor": paths[id(d)], "paragraph_anchors": [paths[id(a)] for a in d.findall('.//al')], "source_file": source['file'],
                              "candidate_article": match.group(1), "targets": [], "origin": "official_text"})
    title = text(root.find('.//intitule'))
    return {"id": pid, "title": title, "source_file": source['file'], "source": source,
            "url": f"https://zoek.officielebekendmakingen.nl/{pid}.html",
            "full_text": text(root), "explanation_fragment_count": len(fragments)}, fragments

def generate_markdown(info, articles):
    base = ROOT / 'vault-export/generated' / info['id'].lower()
    for number, a in articles.items():
        obs = next((o for o in reversed(a['observations']) if o['valid_from'] <= AS_OF <= o['valid_to'] and o['known_from'] <= AS_OF <= o['known_to']), None)
        if not obs:
            continue
        snap = next(x for x in a['snapshots'] if x['id'] == obs['snapshot_id'])
        tree = snap['tree']
        lines = ['---', 'type: legal-article', 'status: generated', f'regulation: {info["id"]}',
                 f'article: "{number}"', f'lineage_id: "{tree["lineage_id"]}"', f'as_of: {AS_OF}',
                 'source: BWB', 'generated: true', '---', '', f'# Artikel {number}' + (f' — {tree["heading"]}' if tree['heading'] else ''), '',
                 f'Brontekst bij peildatum {AS_OF}; toestand {obs["state_id"]}.', '',
                 'Dit is een afgeleide weergave. Eigen aantekeningen horen in `vault-export/annotations/`.', '',
                 f'[Officiële tekst](https://wetten.overheid.nl/jci1.3:c:{info["id"]}&artikel={number}&g={AS_OF}&z={AS_OF})', '',
                 f'[Lokaal bronbestand](../../../{obs["source"]["file"]})', '', '## Tekst', '', snap['full_text'], '',
                 '## Historie', '', f'{len(a["snapshots"])} onderscheiden artikelversies in {len(a["observations"])} toestanden.', '',
                 'Historie vóór de eerste beschikbare toestand is onvolledig. Inhoudelijke classificatie is nog niet uitgevoerd.', '']
        for event in a['wti_events']:
            pubs = ', '.join(f'[{p}](https://zoek.officielebekendmakingen.nl/{p}.html)' for p in event['publication_ids'])
            lines.append(f'- {event["effective_date"] or "Datum onbekend"}: {event["effect"]}; {pubs}')
        lines += ['', '## Officiële toelichting', '']
        for f in a['explanations']:
            lines += [f'### {f["heading"]}', '', f'Mapping: {f["targets"][0]["mapping_method"]}; {f["targets"][0]["status"]}.', '', f['text'], '',
                      f'[Volledige publicatie](https://zoek.officielebekendmakingen.nl/{f["publication_id"]}.html)', '']
        lines += ['', '## Verwijzingen', '']
        refs = {r['jci']: r for n in flatten(tree) for r in n['references']}
        for ref in refs.values():
            lines.append(f'- [{ref["text"]}]({ref["url"]})')
        path = base / f'artikel-{number}.md'
        path.parent.mkdir(parents=True, exist_ok=True)
        # Refuse to overwrite edited generated text, using the previous output hash.
        content = '\n'.join(line.rstrip() for line in lines).rstrip() + '\n'
        checksum = path.with_suffix('.generated.sha256')
        if path.exists() and (not checksum.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != checksum.read_text().strip()):
            raise ValueError(f'Edited generated file; preserved without overwrite: {path}')
        path.write_text(content)
        checksum.write_text(hashlib.sha256(path.read_bytes()).hexdigest() + '\n')

def main():
    dataset, sources, reviews = {}, {}, []
    for rid in REGULATIONS:
        info, articles, publications, review = build_regulation(rid)
        dataset[rid] = (info, articles)
        sources.update(publications)
        reviews.extend(review)
        print(rid, info['state_count'], 'states', len(articles), 'article coordinates', flush=True)
    public_index = ROOT / 'data/source-index/publications.json'
    raw_publications = json.loads(public_index.read_text()) if public_index.exists() else {}
    fragments, mapping_reviews = [], []
    lesson = json.loads((ROOT / 'data/editorial/lesson-timeline.json').read_text())
    lesson_publications = {s['publication_id'] for s in lesson['sources'].values() if s.get('publication_id')}
    raw_publications = {pid: source for pid, source in raw_publications.items() if pid in sources or pid in lesson_publications}
    for pid, source in raw_publications.items():
        publication, chunks = publication_fragments(pid, source)
        sources[pid] = sources.get(pid, {}) | publication
        for f in chunks:
            for rid, (info, articles) in dataset.items():
                number = f['candidate_article']
                a = articles.get(number)
                if a is None:
                    continue
                events = [ev for ev in a['wti_events'] if pid in ev['publication_ids']]
                if not events:
                    continue  # Explicit heading alone does not establish target regulation/version.
                target_dates = {ev['effective_date'] for ev in events}
                observation = next((o for o in a['observations'] if o['valid_from'] in target_dates and o['known_to'] == '9999-12-31'), None)
                if not observation:
                    continue
                snapshot = next(s for s in a['snapshots'] if s['id'] == observation['snapshot_id'])
                f['targets'].append({'regulation_id': rid, 'article': number, 'lineage_id': snapshot['tree']['lineage_id'],
                                     'element_version_id': snapshot['id'], 'effective_date': observation['valid_from'],
                                     'mapping_method': 'deterministic', 'status': 'derived_mapping', 'confidence': None,
                                     'evidence': ['Explicit article heading in the explanatory note', 'Article WTI associates this publication with this effective date']})
                a['explanations'].append(f)
                ordinals = {'eerste': '1', 'tweede': '2', 'derde': '3', 'vierde': '4', 'vijfde': '5', 'zesde': '6'}
                for i, paragraph in enumerate(f['blocks']):
                    match = re.match(r'(?:Ingevolge de in het|Op grond van het) (eerste|tweede|derde|vierde|vijfde|zesde) lid', paragraph)
                    if not match:
                        continue
                    member = next((n for n in snapshot['tree']['children'] if n['type'] == 'member' and n['number'] == ordinals[match.group(1)]), None)
                    if member is None:
                        continue
                    chunk = {**f, 'id': f['id'] + '_p' + str(i), 'blocks': [paragraph], 'text': paragraph,
                             'source_anchor': f['paragraph_anchors'][i], 'targets': [{**f['targets'][-1],
                                'element_key': member['key'], 'lineage_id': member['lineage_id'],
                                'mapping_method': 'deterministic', 'status': 'derived_mapping',
                                'evidence': f['targets'][-1]['evidence'] + ['Paragraph explicitly starts with this numbered member under the article heading']}]}
                    a['explanations'].append(chunk)
                    fragments.append(chunk)
            if not f['targets']:
                mapping_reviews.append(f)
            fragments.append(f)
    output = ROOT / 'app/public/data'
    search = []
    timeline_search = []
    topics = json.loads((ROOT / 'data/editorial/publication-topics.json').read_text())
    metadata = json.loads((ROOT / 'data/source-index/publication-metadata.json').read_text())['publications']
    for pid, publication in sources.items():
        if pid in metadata:
            publication['title'] = metadata[pid]['title']
            publication['metadata_source_file'] = metadata[pid]['source_file']
            publication['metadata_source_anchor'] = metadata[pid]['source_anchor']
    def article_order(number):
        return tuple((0, int(part)) if part.isdigit() else (1, part) for part in re.findall(r'\d+|\D+', number))
    for rid, (info, articles) in dataset.items():
        write_json(output / 'regulations' / rid / 'index.json', info)
        write_json(ROOT / 'data/normalized/regulations' / (rid + '.json'), info)
        visible_states = sorted((s for s in info['states'] if s['known_from'] <= AS_OF <= s['known_to']), key=lambda s: s['valid_from'])
        comparison_dates = {s['valid_from'] for s in visible_states[1:]}
        changed_articles = {day: {number for number, a in articles.items()
            if any(c['effective_date'] == day and c['classification'] != 'structural' for c in a['changes'])
            or min(o['valid_from'] for o in a['observations']) == day}
            for day in comparison_dates}
        def timeline(events, title, changes=None, article_number=None):
            grouped = {}
            for ev in events:
                day = ev['effective_date']
                if not day:
                    continue
                item = grouped.setdefault(day, {'id': 'event_' + digest([rid, title, day])[:20], 'effective_date': day,
                    'title': ev['effect'] or 'Wijziging', 'summary': 'Officiële wijzigingsinformatie uit WTI.',
                    'publication_ids': [], 'commencement_publication_ids': [], 'notes': []})
                for key in ('publication_ids', 'commencement_publication_ids', 'notes'):
                    item[key] = list(dict.fromkeys(item[key] + ev[key]))
                if changes is not None:
                    item['change_count'] = sum(c['effective_date'] == day for c in changes)
            for day, item in grouped.items():
                milestone = next((e for e in lesson['events'] if e.get('importance') == 'major'
                    and e.get('register_target', {}).get('regulation_id') == rid and e.get('date') == day), None)
                item['importance'] = 'major' if milestone else 'unknown'
                item['editorial_title'] = milestone['title'] if milestone else None
                item['importance_origin'] = 'lesson_editorial' if milestone else 'unassessed'
                item['importance_reason'] = ('Hoofdmijlpaal in de lesselectie: ' + milestone['title']) if milestone else 'Juridische impact nog niet beoordeeld.'
                count = len(changed_articles[day]) if day in comparison_dates else None
                item['changed_article_count'] = count
                item['extent'] = 'broad' if count is not None and count >= 10 else 'limited' if count else 'unknown'
                item['extent_origin'] = 'derived_state_comparison'
                item['extent_basis'] = 'Aantal artikelen met berekende niet-structurele wijzigingen in deze regeling op deze ingangsdatum; breed vanaf 10. Geen juridische impactclassificatie.'
                item['display_level'] = 'major' if milestone or item['extent'] == 'broad' else 'minor' if item['extent'] == 'limited' else 'unknown'
                item['mini_events'] = []
                for key, kind, label in (('publication_ids', 'publication', 'Wijziging gepubliceerd'),
                                         ('commencement_publication_ids', 'commencement_publication', 'Inwerkingtredingsbesluit gepubliceerd')):
                    for pid in item[key]:
                        publication_day = sources.get(pid, {}).get('publication_date')
                        if publication_day and re.fullmatch(r'\d{4}-\d{2}-\d{2}', publication_day):
                            item['mini_events'].append({'id': kind + '_' + pid, 'date': publication_day,
                                'kind': kind, 'title': label, 'publication_id': pid, 'origin': 'official_wti_metadata'})
                item['mini_events'].append({'id': item['id'] + '_effective', 'date': day,
                    'kind': 'effective', 'title': 'Inwerkingtreding', 'origin': 'official_wti_metadata'})
                item['mini_events'].sort(key=lambda step: (step['date'], step['id']))
                affected = []
                for number, a in sorted(articles.items(), key=lambda pair: article_order(pair[0])):
                    if article_number and number != article_number:
                        continue
                    pids = sorted({pid for ev in a['wti_events'] if ev['effective_date'] == day
                        for pid in ev['publication_ids'] if pid in item['publication_ids']})
                    computed = number in changed_articles.get(day, set())
                    if not pids and not computed:
                        continue
                    observation = next((o for o in a['observations'] if o['valid_from'] <= day <= o['valid_to']
                        and o['known_from'] <= AS_OF <= o['known_to']), None)
                    snapshot = next((s for s in a['snapshots'] if observation and s['id'] == observation['snapshot_id']), None)
                    affected.append({'number': number, 'heading': snapshot['tree']['heading'] if snapshot else '',
                        'path': observation['path'] if observation else [], 'publication_ids': pids,
                        'evidence': 'official_article_wti' if pids else 'derived_state_comparison',
                        'state_id': observation['state_id'] if observation else None})
                override = next((o for o in topics['event_overrides'] if o['regulation_id'] == rid
                    and o['effective_date'] == day and o['publication_id'] in item['publication_ids']), {})
                item['regulation_id'] = rid
                item['regulation_name'] = 'Arbowet' if rid == 'BWBR0010346' else 'Arbobesluit'
                item['topics'] = list(dict.fromkeys(topics['labels'].get(pid, 'Onderwerp onbekend') for pid in item['publication_ids']))
                item['short_label'] = override.get('short_label') or (item['topics'][0] if item['topics'] else 'Onderwerp onbekend')
                item['label_origin'] = 'editorial_source_title'
                item['label_publication_ids'] = item['publication_ids']
                item['affected_articles'] = affected
                item['focus_article'] = article_number or override.get('focus_article') or next((a['number'] for a in affected), '5' if rid == 'BWBR0010346' else '2.5')
                primary = [a for a in affected if item['publication_ids'] and item['publication_ids'][0] in a['publication_ids']] or affected
                item['article_summary'] = ('Art. ' + ', '.join(a['number'] for a in primary[:3]) + (f' +{len(primary)-3}' if len(primary) > 3 else '')) if primary else 'Artikelkoppeling ontbreekt'
                item['context'] = override.get('context', '')
                item['summary'] = override.get('summary', ' · '.join(item['topics']))
                item['detail'] = override.get('detail', '')
                item['subject_sources'] = override.get('source_urls', [])
                item['source_publications'] = [{'id': pid, 'title': sources.get(pid, {}).get('title', pid),
                    'label': topics['labels'].get(pid, 'Onderwerp onbekend'),
                    'metadata_source_file': sources.get(pid, {}).get('metadata_source_file'),
                    'metadata_source_anchor': sources.get(pid, {}).get('metadata_source_anchor')} for pid in item['publication_ids']]
                aliases = [alias for pid in item['publication_ids'] for alias in topics['aliases'].get(pid, [])]
                item['search_text'] = ' '.join([item['short_label'], *item['topics'], *aliases, item['regulation_name'],
                    info['title'], day, 'wetgeving wijziging', item['context'], *item['publication_ids'],
                    *[p['title'] for p in item['source_publications']],
                    *[f"{a['number']} {a['heading']}" for a in affected]])
            return {'title': title, 'regulation_id': rid, 'events': sorted(grouped.values(), key=lambda e: e['effective_date']),
                    'undated_events': [ev for ev in events if not ev['effective_date']]}
        regulation_timeline = timeline(info['regulation_events'], info['title'])
        write_json(output / 'regulations' / rid / 'timeline.json', regulation_timeline)
        timeline_search.extend({k: e[k] for k in ('id', 'regulation_id', 'regulation_name', 'effective_date',
            'short_label', 'topics', 'article_summary', 'context', 'focus_article', 'search_text')} for e in regulation_timeline['events'])
        for number, a in articles.items():
            write_json(output / 'regulations' / rid / 'articles' / (number + '.json'), a)
            write_json(output / 'regulations' / rid / 'articles' / (number + '-timeline.json'), timeline(a['wti_events'], f'Artikel {number}', a['changes'], number))
            observation = next((o for o in reversed(a['observations']) if o['valid_from'] <= AS_OF <= o['valid_to'] and o['known_from'] <= AS_OF <= o['known_to']), None)
            if observation:
                snapshot = next(s for s in a['snapshots'] if s['id'] == observation['snapshot_id'])
                search.append({'id': rid + ':' + number, 'regulation_id': rid, 'number': number, 'heading': snapshot['tree']['heading'],
                               'status': snapshot['tree']['status'], 'text': snapshot['full_text']})
        generate_markdown(info, articles)
    for pid, p in sources.items():
        p['downloaded'] = pid in raw_publications
        write_json(ROOT / 'data/normalized/publications' / (pid + '.json'), p)
        # Browser loads full publications separately; never part of the global index.
        if p['downloaded']:
            write_json(output / 'publications' / (pid + '.json'), p)
    write_json(ROOT / 'data/normalized/explanations/fragments.json', fragments)
    write_json(ROOT / 'data/review/lineage/candidates.json', reviews)
    write_json(ROOT / 'data/review/mappings/candidates.json', mapping_reviews)
    write_json(output / 'search-index.json', search)
    write_json(output / 'timeline-search-index.json', timeline_search)
    archived_sources = json.loads((ROOT / 'data/source-index/lesson-sources.json').read_text())
    for sid, source in lesson['sources'].items():
        archive = archived_sources.get(sid, {})
        source['source_file'] = archive.get('file')
        source['archive_error'] = archive.get('error')
    write_json(output / 'lesson-timeline.json', lesson)
    write_json(output / 'index.json', {'schema_version': 1, 'as_of': AS_OF, 'regulations': [
        {k: info[k] for k in ('id', 'title', 'state_count', 'coverage_from', 'current_state_id', 'manifest_hash_mismatches')} | {'article_count': len(info['articles'])}
        for info, articles in dataset.values()], 'publications_total': len(sources), 'publications_downloaded': len(raw_publications),
        'explanations_mapped': sum(bool(f['targets']) for f in fragments), 'lineage_reviews': len(reviews),
        'limitations': ['History starts with available repository states, not enactment.', 'Manifest hash equivalence unresolved.',
                        'Substantive change classification not yet verified.', 'No automatic semantic lineage for positional members or split/merge.',
                        'Only mappings with explicit article headings and WTI evidence; limited explicit-member mappings remain derived, unreviewed.',
                        'Annexes and non-text media remain in raw XML; no complete rendered annex export yet.']})
    print('mapped explanations', sum(bool(f['targets']) for f in fragments), 'review candidates', len(reviews))

if __name__ == '__main__':
    main()
