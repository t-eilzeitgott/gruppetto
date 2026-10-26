"""Kürzt eine PCS-Etappenseite auf das, was der Parser braucht (Struktur bleibt original)."""
import re, sys

def block(h, start, tag):
    """Gibt das Ende (exklusiv) des bei start beginnenden <tag>-Elements zurück (verschachtelt gezählt)."""
    depth = 0
    for m in re.finditer(r'<(/?)%s\b[^>]*>' % tag, h[start:]):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return start + m.end()
    raise ValueError('kein Ende für ' + tag)

def trim_table(t, keep):
    head, rest = t.split('<tbody>', 1) if '<tbody>' in t else (t, '')
    if not rest:
        return t
    body, tail = rest.rsplit('</tbody>', 1)
    rows = re.findall(r'<tr\b.*?</tr>', body, flags=re.S)
    out, n = [], 0
    for r in rows:
        first = re.match(r'<tr[^>]*>\s*<td[^>]*>(.*?)</td>', r, flags=re.S)
        cell = first.group(1) if first else ''
        numeric = re.fullmatch(r'\s*\d+\s*', re.sub(r'<[^>]+>', '', cell) or '') and '<s>' not in cell
        if numeric:
            n += 1
            if n <= keep:
                out.append(r)
        else:
            out.append(r)
    return head + '<tbody>\n' + '\n'.join(out) + '\n</tbody>' + tail

def trim(h, keep=12):
    parts = []
    t = re.search(r'<title>.*?</title>', h, flags=re.S).group(0)
    canon = re.search(r'<link rel="canonical"[^>]*>', h)
    parts.append('<!DOCTYPE html><html><head>' + t + (canon.group(0) if canon else '') + '</head><body>')
    i = h.find('<div class="page-title">')
    parts.append(h[i:block(h, i, 'div')])
    m = re.search(r'<ul class="(tabs tabnav resultTabs|restabs)[^"]*"', h)
    if m:
        parts.append(h[m.start():block(h, m.start(), 'ul')])
    for m in re.finditer(r'<div class="resTab[^"]*" data-id="\d+">', h):
        s = m.start(); e = block(h, s, 'div')
        seg = h[s:e]
        g = seg.find('<div class="general">')
        if g < 0:
            parts.append(seg)  # z. B. Mannschaftszeitfahren
            continue
        ge = block(seg, g, 'div')
        general = seg[g:ge]
        ts = general.find('<table')
        if ts >= 0:
            te = block(general, ts, 'table')
            general = general[:ts] + trim_table(general[ts:te], keep) + '</div>'
        parts.append(m.group(0) + general + '</div>')
    i = h.find('<h4>Race information</h4>')
    j = h.find('<ul', i)
    parts.append('<div class="info">' + h[i:j] + h[j:block(h, j, 'ul')] + '</div>')
    parts.append('</body></html>\n')
    out = '\n'.join(parts)
    out = re.sub(r'<script\b.*?</script>', '', out, flags=re.S)
    return out

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    keep = int(sys.argv[3]) if len(sys.argv) > 3 else 12
    h = open(src, encoding='utf-8').read()
    open(dst, 'w', encoding='utf-8').write(trim(h, keep))
