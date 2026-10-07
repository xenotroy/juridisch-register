"""Acquire compact official publication metadata via KOOP SRU; preserve raw bytes."""
import argparse
import json
from urllib.parse import urlencode
import xml.etree.ElementTree as ET
from download import ROOT, fetch

NS = {'sru': 'http://docs.oasis-open.org/ns/search-ws/sruResponse',
      'dc': 'http://purl.org/dc/terms/'}

def parse_records(content, source):
    xml = ET.fromstring(content)
    records = {}
    for record in xml.findall('.//sru:record', NS):
        pid = record.findtext('.//dc:identifier', namespaces=NS)
        title = record.findtext('.//dc:title', namespaces=NS)
        if pid and title:
            records[pid] = {'id': pid, 'title': title,
                'publication_date': record.findtext('.//dc:issued', namespaces=NS),
                'source_file': source['file'], 'origin': 'official_sru_metadata',
                'source_anchor': f"//sru:record[.//dcterms:identifier='{pid}']",
                'url': f'https://zoek.officielebekendmakingen.nl/{pid}.html'}
    return records

def main(refresh=False):
    output = ROOT / 'data/source-index/publication-metadata.json'
    if output.exists() and not refresh:
        print('Using preserved publication metadata; pass --refresh to acquire again.')
        return
    identifiers = sorted(p.stem for p in (ROOT / 'data/normalized/publications').glob('*.json'))
    result = {'service': 'https://repository.overheid.nl/sru', 'batches': [], 'publications': {}}
    for start in range(0, len(identifiers), 30):
        batch = identifiers[start:start+30]
        query = 'c.product-area==officielepublicaties AND (' + ' OR '.join(f'dt.identifier=="{pid}"' for pid in batch) + ')'
        url = result['service'] + '?' + urlencode({'operation': 'searchRetrieve', 'version': '2.0',
            'query': query, 'maximumRecords': len(batch)})
        source = fetch(url, ROOT / 'data/raw/publication-metadata')
        records = parse_records((ROOT / source['file']).read_bytes(), source)
        if not records or not set(records) <= set(batch):
            raise ValueError('Unexpected SRU records; metadata index not replaced')
        result['batches'].append(source)
        result['publications'].update(records)
        print(f'Metadata: {len(result["publications"])} / {len(identifiers)}', flush=True)
    result['missing_identifiers'] = sorted(set(identifiers) - set(result['publications']))
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    main(parser.parse_args().refresh)
