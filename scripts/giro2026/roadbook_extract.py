"""Liest aus dem offiziellen Roadbook (Garibaldi, PDF → pdftotext -layout) die Durchfahrtstabellen,
Bergwertungen, Zwischensprints, Red-Bull-KM und Verpflegungszonen aller Etappen.
Aufruf: pdftotext -layout garibaldi.pdf g.txt && python3 roadbook_extract.py g.txt roadbook.json"""
import json, re, sys

src, dst = sys.argv[1], sys.argv[2]
L = open(src, encoding='utf-8').read().split('\n')
num = r'(\d{1,3},\d)'
full = re.compile(r'^\s*(?:(\d|CC|C)\s+)?(\d{1,4})\s+(\S.*?)\s{2,}([#;:L]?)\s*(.*?)\s+' + num + r'\s+' + num + r'\s+' + num + r'\s+\d{1,2}[.:]\d{2}')
head = re.compile(r'^\s*(?:(\d|CC|C)\s+)?(\d{1,4})\s+(\S.*?)\s{2,}([#;:L]?)\s*(\S.*)?$')
tail = re.compile(r'^\s+' + num + r'\s+' + num + r'\s+' + num + r'\s+\d{1,2}[.:]\d{2}')
f = lambda s: float(s.replace(',', '.'))

rows = []
pending = None
for i, l in enumerate(L):
    m = full.match(l)
    if m:
        cat, alt, place, _, road, part, cov, togo = m.groups()
        rows.append({'line': i, 'cat': cat, 'alt': int(alt), 'name': place.strip(), 'km': f(cov), 'togo': f(togo)})
        pending = None
        continue
    t = tail.match(l)
    if t and pending:
        part, cov, togo = t.groups()
        rows.append({**pending, 'km': f(cov), 'togo': f(togo)})
        pending = None
        continue
    h = head.match(l)
    if h and not re.search(r'\d+,\d', l) and len(h.group(3)) > 1 and not l.strip().startswith('PROVINCIA'):
        cat, alt, place, _, road = h.groups()
        pending = {'line': i, 'cat': cat, 'alt': int(alt), 'name': place.strip()}

# in Etappen gruppieren: neue Etappe, wenn die gefahrenen km zurückspringen
stages, cur, last = [], [], -1
for r in rows:
    if cur and r['km'] < last - 0.01:
        stages.append(cur); cur = []
    cur.append(r); last = r['km']
stages.append(cur)
assert len(stages) == 21, len(stages)

def notes_after(line_no):
    """Notizblock (NOTE/NOTES) nach der Tabelle"""
    for j in range(line_no, min(line_no + 80, len(L))):
        if 'NOTE/NOTES' in L[j]:
            block = []
            for k in range(j + 1, min(j + 40, len(L))):
                if re.match(r'^\s*\d{3}\s*$', L[k]) or re.match(r'^STAGE\s*$', L[k].strip()):
                    break
                block.append(L[k])
            return block
    return []

out = []
for n, s in enumerate(stages, start=1):
    block = notes_after(s[-1]['line'])
    text = '\n'.join(block)
    gpm = [{'km': float(k), 'name': nm.strip(), 'alt': int(a), 'cat': c}
           for k, nm, a, c in re.findall(r'km\s*([\d.]+)\s*-\s*(.+?)\s+-\s+m\s*(\d+)\s*\(([1-4]|[^)\n]*Coppi)', text)]
    # Zwischensprints: Zeilen direkt unter der Überschrift (linke Spalte)
    sprints = []
    for idx, l in enumerate(block):
        if 'Traguardi Volanti' in l or 'Intermediate Sprints' in l:
            for l2 in block[idx + 1: idx + 4]:
                m = re.match(r'^\s*km\s*([\d.]+)\s*-\s*(.+?)(?:\s{2,}|$)', l2)
                if m: sprints.append({'km': float(m.group(1)), 'name': m.group(2).strip()})
                else: break
    rb = None
    for idx, l in enumerate(block):
        if re.match(r'^\s*Red Bull\b', l):
            m = re.match(r'^\s*km\s*([\d.]+)', block[idx + 1]) if idx + 1 < len(block) else None
            if m: rb = float(m.group(1))
    feed = re.findall(r'Feed/Litter zone[^\n]*\n\s*km\s*([\d.\s\-–]+)', text)
    out.append({
        'n': n,
        'waypoints': [{'km': r['km'], 'alt': r['alt'], 'name': r['name'], **({'cat': r['cat']} if r['cat'] else {})} for r in s],
        'gpm': gpm,
        'sprints': sprints,
        'redbull_km': rb,
        'feed': feed[0].strip() if feed else None,
    })

json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for st in out:
    w = st['waypoints']
    print(st['n'], len(w), w[0]['name'], w[0]['alt'], '→', w[-1]['name'], w[-1]['alt'], w[-1]['km'], 'GPM', len(st['gpm']), 'S', st['sprints'], 'RB', st['redbull_km'])
