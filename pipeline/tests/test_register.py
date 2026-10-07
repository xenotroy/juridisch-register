"""Integrity and legal boundary checks against the acquired source dataset."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build

ROOT = build.ROOT
PUBLIC = ROOT / "app/public/data"


def read(path):
    return json.loads(path.read_text())


def article(rid, number):
    return read(PUBLIC / f"regulations/{rid}/articles/{number}.json")


def at(data, day, known=build.AS_OF):
    observations = [o for o in data["observations"] if o["valid_from"] <= day <= o["valid_to"]
                    and o["known_from"] <= known <= o["known_to"]]
    if not observations:
        return None
    assert len(observations) == 1, (day, known, observations)
    return next(s for s in data["snapshots"] if s["id"] == observations[0]["snapshot_id"])


class RegisterTests(unittest.TestCase):
    def test_every_acquired_state_matches_local_checksum_and_identity(self):
        count = 0
        for rid in build.REGULATIONS:
            index = read(ROOT / f"data/source-index/{rid}.json")
            for state in index["states"]:
                source = state["source"]
                content = (ROOT / source["file"]).read_bytes()
                self.assertEqual(hashlib.sha256(content).hexdigest(), source["sha256"])
                self.assertEqual(len(content), source["bytes"])
                xml = ET.fromstring(content)
                self.assertEqual(xml.get("bwb-id"), rid)
                self.assertEqual(xml.get("inwerkingtreding"), state["datum_inwerkingtreding"])
                self.assertEqual(hashlib.sha512(content).hexdigest() == source["manifest_sha512"], source["koop_hash_verified"])
                count += 1
        self.assertEqual(count, 121)

    def test_normalized_hierarchy_and_article_inventory_match_every_raw_state(self):
        for rid in build.REGULATIONS:
            index = read(ROOT / f"data/source-index/{rid}.json")
            for state in index["states"]:
                raw = ET.parse(ROOT / state["source"]["file"]).getroot()
                normalized = read(ROOT / f"data/normalized/states/{rid}/{state['label']}.json")
                nodes = [n for root in normalized["tree"] for n in build.flatten(root)]
                by_key = {n["key"]: n for n in nodes}
                self.assertEqual(len(by_key), len(nodes))
                self.assertEqual(sum(n["type"] == "article" for n in nodes), len(raw.findall("wetgeving/wet-besluit/wettekst//artikel")))
                for node in nodes:
                    for child in node["children"]:
                        self.assertEqual(child["parent_key"], node["key"])
                    if node["parent_key"]:
                        self.assertIn(node["parent_key"], by_key)

    def test_state_periods_do_not_overlap_when_observed_today(self):
        for rid in build.REGULATIONS:
            info = read(PUBLIC / f"regulations/{rid}/index.json")
            states = sorted((s for s in info["states"] if s["known_from"] <= build.AS_OF <= s["known_to"]), key=lambda s: s["valid_from"])
            for left, right in zip(states, states[1:]):
                self.assertLess(left["valid_to"], right["valid_from"], (rid, left["id"], right["id"]))

    def test_arie_boundary_does_not_reuse_old_text(self):
        data = article("BWBR0008498", "2.5")
        old, new = at(data, "2022-12-31"), at(data, "2023-01-01")
        self.assertEqual(old["tree"]["heading"], "Omstandigheidsfactoren")
        self.assertIn("beleid inzake beheersing", new["tree"]["heading"])
        self.assertIn("voor een stof die zich bevindt", old["full_text"])
        self.assertIn("De werkgever legt de algemene doelstellingen", new["full_text"])
        self.assertNotEqual(old["id"], new["id"])
        self.assertTrue(any(c["effective_date"] == "2023-01-01" and "stb-2022-501" in c["publication_ids"] for c in data["changes"]))

    def test_member_changes_remain_unknown_until_reviewed(self):
        data = article("BWBR0008498", "2.5")
        self.assertTrue(any(c["type"] == "member" for c in data["changes"]))
        for change in data["changes"]:
            if change["before"] != change["after"]:
                self.assertEqual(change["classification"], "unknown")
                self.assertIsNone(change["classification_confidence"])

    def test_text_before_available_history_is_not_invented(self):
        data = article("BWBR0010346", "5")
        self.assertIsNone(at(data, "1999-11-01"))
        self.assertIsNotNone(at(data, "2002-04-01"))
        self.assertIsNotNone(at(data, build.AS_OF))

    def test_explanatory_fragments_have_exact_source_and_version_evidence(self):
        fragments = read(ROOT / "data/normalized/explanations/fragments.json")
        mapped, members = 0, 0
        for fragment in fragments:
            if not fragment["targets"]:
                continue
            mapped += 1
            root = ET.parse(ROOT / fragment["source_file"]).getroot()
            anchor = fragment["source_anchor"].split("/", 2)[2]
            source_element = root.find(anchor)
            self.assertIsNotNone(source_element, fragment["source_anchor"])
            source_text = build.text(source_element)
            for block in fragment["blocks"]:
                self.assertIn(block, source_text)
            for target in fragment["targets"]:
                data = article(target["regulation_id"], target["article"])
                snapshot = next(s for s in data["snapshots"] if s["id"] == target["element_version_id"])
                self.assertTrue(any(ev["effective_date"] == target["effective_date"] and fragment["publication_id"] in ev["publication_ids"] for ev in data["wti_events"]))
                self.assertEqual(target["status"], "derived_mapping")
                if "element_key" in target:
                    members += 1
                    self.assertIn(target["element_key"], {n["key"] for n in build.flatten(snapshot["tree"])})
                    self.assertGreaterEqual(len(target["evidence"]), 3)
        self.assertEqual(mapped, 20)
        self.assertEqual(members, 6)

    def test_lesson_sources_and_date_precision_are_explicit(self):
        lesson = read(PUBLIC / "lesson-timeline.json")
        self.assertEqual(len(lesson["events"]), 17)
        self.assertEqual([e["year"] for e in lesson["events"]], sorted(e["year"] for e in lesson["events"]))
        for event in lesson["events"]:
            self.assertTrue(event["fact"] and event["question"] and event["answer"])
            if event["date_precision"] == "year":
                self.assertIsNone(event["date"])
            for sid in event["sources"]:
                source = lesson["sources"][sid]
                self.assertTrue(source["url"].startswith("https://"))
                self.assertTrue(source["source_file"] or source["archive_error"])
                if source["source_file"]:
                    self.assertTrue((ROOT / source["source_file"]).is_file())

    def test_lesson_hierarchy_keeps_all_steps_and_valid_chronological_parents(self):
        lesson = read(PUBLIC / 'lesson-timeline.json')
        by_id = {e['id']: e for e in lesson['events']}
        major = [e for e in lesson['events'] if e['importance'] == 'major']
        minor = [e for e in lesson['events'] if e['importance'] == 'minor']
        self.assertEqual(len(major), 9)
        self.assertEqual(len(minor), 8)
        self.assertEqual(len(by_id), 17)
        for event in major:
            self.assertIsNone(event['parent_event_id'])
        for event in minor:
            parent = by_id[event['parent_event_id']]
            self.assertEqual(parent['importance'], 'major')
            self.assertLessEqual(parent['year'], event['year'])
            self.assertNotEqual(parent['id'], event['id'])
        self.assertEqual(by_id['effect1983']['parent_event_id'], 'law1980')
        self.assertEqual(by_id['implement1994']['parent_event_id'], 'eu1989')

    def test_incident_cases_remain_distinct_from_legal_milestones_and_have_offline_evidence(self):
        lesson = read(PUBLIC / 'lesson-timeline.json')
        cases = lesson['incidents']
        self.assertEqual([c['date'] for c in cases], ['1975-11-07', '1976-07-10', '2000-05-13', '2011-01-05'])
        self.assertEqual([c['country'] for c in cases], ['Nederland', 'Italië', 'Nederland', 'Nederland'])
        self.assertFalse({c['id'] for c in cases} & {e['id'] for e in lesson['events']})
        for case in cases:
            self.assertEqual(case['kind'], 'incident')
            self.assertEqual(case['date_precision'], 'day')
            self.assertTrue(all(case[field] for field in ['fact', 'meaning', 'question', 'answer']))
            self.assertNotIn('importance', case)
            self.assertNotIn('register_target', case)
            for sid in case['sources']:
                self.assertTrue((ROOT / lesson['sources'][sid]['source_file']).is_file())
        development = lesson['responsibility_development']
        self.assertEqual(development['interpretation_origin'], 'lesson_editorial')
        major = {e['id'] for e in lesson['events'] if e['importance'] == 'major'}
        self.assertTrue(all(phase['event_id'] in major for phase in development['phases']))
        self.assertIn('overheid blijft', development['summary'].lower())
        self.assertTrue(all(lesson['sources'][sid]['source_file'] for sid in development['sources']))

    def test_lesson_article_routes_keep_historical_text_and_current_core_articles(self):
        lesson = read(PUBLIC / 'lesson-timeline.json')
        by_id = {e['id']: e for e in lesson['events']}
        for event in lesson['events']:
            for ref in event.get('legal_refs', []):
                self.assertIsNotNone(at(article(ref['regulation_id'], ref['article']), ref.get('date', lesson['as_of'])), ref)
        self.assertEqual({r['article'] for r in by_id['implement1994']['legal_refs']}, {'3', '5', '8'})
        for event_id, parent in [('arie2004', 'decision1997'), ('arie2023', 'decision1997'), ('prevention2005', 'law1999')]:
            self.assertEqual(by_id[event_id]['parent_event_id'], parent)
            self.assertTrue(all(r['date'] == by_id[event_id]['date'] for r in by_id[event_id]['legal_refs']))
        old_ref = by_id['arie2004']['legal_refs'][0]
        new_ref = next(r for r in by_id['arie2023']['legal_refs'] if r['article'] == old_ref['article'])
        old = at(article(old_ref['regulation_id'], old_ref['article']), old_ref['date'])
        new = at(article(new_ref['regulation_id'], new_ref['article']), new_ref['date'])
        self.assertIn('risico-inventarisatie', old['tree']['heading'])
        self.assertIn('noodplan', new['tree']['heading'])
        self.assertNotEqual(old['id'], new['id'])

    def test_legal_mini_timelines_use_recorded_dates_without_classifying_unknown_impact(self):
        publications = {p.stem: read(p) for p in (ROOT / 'data/normalized/publications').glob('*.json')}
        for rid in build.REGULATIONS:
            paths = [PUBLIC / f'regulations/{rid}/timeline.json', PUBLIC / f'regulations/{rid}/articles/3-timeline.json'] if rid == 'BWBR0010346' else [PUBLIC / f'regulations/{rid}/timeline.json', PUBLIC / f'regulations/{rid}/articles/2.5-timeline.json']
            for path in paths:
                for event in read(path)['events']:
                    self.assertIn(event['importance'], ['major', 'unknown'])
                    if event['importance'] == 'unknown':
                        self.assertEqual(event['importance_origin'], 'unassessed')
                    else:
                        self.assertEqual(event['importance_origin'], 'lesson_editorial')
                    count = event['changed_article_count']
                    if event['extent'] == 'broad':
                        self.assertGreaterEqual(count, 10)
                        self.assertEqual(event['display_level'], 'major')
                    elif event['extent'] == 'limited':
                        self.assertTrue(1 <= count <= 9)
                        self.assertIn(event['display_level'], ['major', 'minor'])
                    else:
                        self.assertTrue(count is None or count == 0)
                    self.assertEqual(event['extent_origin'], 'derived_state_comparison')
                    steps = event['mini_events']
                    self.assertEqual([s['date'] for s in steps], sorted(s['date'] for s in steps))
                    effective = [s for s in steps if s['kind'] == 'effective']
                    self.assertEqual(len(effective), 1)
                    self.assertEqual(effective[0]['date'], event['effective_date'])
                    for step in steps:
                        self.assertEqual(step['origin'], 'official_wti_metadata')
                        if step.get('publication_id'):
                            self.assertEqual(step['date'], publications[step['publication_id']]['publication_date'])
                            self.assertIn(step['publication_id'], event['publication_ids'] + event['commencement_publication_ids'])

    def test_generation_preserves_manually_edited_output(self):
        data = article("BWBR0010346", "5")
        info = read(PUBLIC / "regulations/BWBR0010346/index.json")
        with tempfile.TemporaryDirectory() as directory, patch.object(build, "ROOT", Path(directory)):
            build.generate_markdown(info, {"5": data})
            path = Path(directory) / "vault-export/generated/bwbr0010346/artikel-5.md"
            path.write_text(path.read_text() + "\nEigen opmerking.\n")
            before = path.read_bytes()
            with self.assertRaisesRegex(ValueError, "Edited generated file"):
                build.generate_markdown(info, {"5": data})
            self.assertEqual(path.read_bytes(), before)

    def test_subject_labels_and_official_metadata_cover_every_timeline_event(self):
        from publication_metadata import parse_records
        metadata = read(ROOT / 'data/source-index/publication-metadata.json')
        recovered = {}
        for source in metadata['batches']:
            content = (ROOT / source['file']).read_bytes()
            self.assertEqual(hashlib.sha256(content).hexdigest(), source['sha256'])
            recovered.update(parse_records(content, source))
        self.assertEqual(recovered, metadata['publications'])
        self.assertEqual(metadata['missing_identifiers'], [])
        for rid in build.REGULATIONS:
            for event in read(PUBLIC / f'regulations/{rid}/timeline.json')['events']:
                self.assertTrue(1 <= len(event['short_label'].split()) <= 3)
                self.assertNotEqual(event['short_label'].lower(), 'wijziging')
                self.assertEqual(event['regulation_id'], rid)
                for source in event['source_publications']:
                    self.assertEqual(source['title'], recovered[source['id']]['title'])
                for target in event['affected_articles']:
                    a = article(rid, target['number'])
                    if target['evidence'] == 'official_article_wti':
                        self.assertTrue(any(e['effective_date'] == event['effective_date']
                            and set(e['publication_ids']) & set(event['publication_ids']) for e in a['wti_events']))
                    if target['state_id']:
                        observation = next(o for o in a['observations'] if o['state_id'] == target['state_id'])
                        self.assertLessEqual(observation['valid_from'], event['effective_date'])
                        self.assertGreaterEqual(observation['valid_to'], event['effective_date'])
                        self.assertEqual(target['path'], observation['path'])

    def test_arie_search_entry_identifies_regulation_date_and_new_provisions(self):
        index = read(PUBLIC / 'timeline-search-index.json')
        self.assertEqual(len(index), 130)
        hits = [e for e in index if e['regulation_id'] == 'BWBR0008498' and e['effective_date'] == '2023-01-01']
        self.assertEqual(len(hits), 1)
        hit = hits[0]
        self.assertEqual(hit['short_label'], 'ARIE herziening')
        self.assertEqual(hit['focus_article'], '2.5')
        self.assertIn('stb-2022-501', hit['search_text'])
        event = next(e for e in read(PUBLIC / 'regulations/BWBR0008498/timeline.json')['events'] if e['id'] == hit['id'])
        self.assertTrue({'2.2','2.3','2.4','2.5','2.5a','2.5b','2.5j'} <= {a['number'] for a in event['affected_articles']})
        self.assertEqual(event['importance'], 'unknown')
        single = next(e for e in read(PUBLIC / 'regulations/BWBR0008498/articles/2.5-timeline.json')['events'] if e['effective_date'] == '2023-01-01')
        self.assertEqual([a['number'] for a in single['affected_articles']], ['2.5'])


if __name__ == "__main__":
    unittest.main()
