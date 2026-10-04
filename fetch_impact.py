import json, urllib.request, time, os
UA = {"User-Agent": "RadarAroundYou-prototype/0.2 (contact: " + os.environ.get("CONTACT_EMAIL", "not set") + ")"}
def get(u):
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60) as r: return json.loads(r.read())
        except Exception as e:
            time.sleep(3 * (i + 1))
    return None
week = json.load(open('raw/usgs_2.5_week.geojson'))
feed = get("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson")
top = sorted(feed['features'], key=lambda f: -f['properties']['mag'])[:14]
newest = sorted(week['features'], key=lambda f: -f['properties']['time'])[:3]
os.makedirs('raw2/impact', exist_ok=True)
seen = set(); out = {}
for f in top + newest:
    eid = f['id']
    if eid in seen: continue
    seen.add(eid)
    d = get(f['properties']['detail'])
    if not d: continue
    p = d['properties']; pr = p.get('products', {})
    item = {"id": eid, "mag": p['mag'], "place": p['place'], "time": p['time'], "depth": d['geometry']['coordinates'][2],
            "lat": d['geometry']['coordinates'][1], "lon": d['geometry']['coordinates'][0], "tsunami": p.get('tsunami'), "alert": p.get('alert'),
            "felt": p.get('felt'), "cdi": p.get('cdi'), "mmi": p.get('mmi'), "sig": p.get('sig'), "url": p.get('url')}
    if 'shakemap' in pr:
        c = pr['shakemap'][0]['contents']
        if 'download/cont_mmi.json' in c:
            cont = get(c['download/cont_mmi.json']['url'])
            if cont:
                lines = []
                for ft in cont['features']:
                    g = ft['geometry']; v = ft['properties']['value']
                    parts = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
                    for ln in parts:
                        if len(ln) < 3: continue
                        step = max(1, len(ln) // 90)
                        pts = ln[::step]
                        if pts[-1] != ln[-1]: pts.append(ln[-1])
                        lines.append({"v": v, "p": [[round(x, 3), round(y, 3)] for x, y in pts]})
                item["contours"] = lines
    if 'losspager' in pr:
        c = pr['losspager'][0]['contents']
        if 'json/exposures.json' in c:
            ex = get(c['json/exposures.json']['url'])
            if ex:
                pe = ex['population_exposure']
                item["exposure"] = {"mmi": pe['mmi'], "pop": [round(x) for x in pe['aggregated_exposure']], "countries": [{"cc": ce['country_code'], "pop": [round(x) for x in ce['exposure']]} for ce in pe.get('country_exposures', [])][:4]}
        if 'json/alerts.json' in c:
            al = get(c['json/alerts.json']['url'])
            if al: item["pager"] = {k: v.get('level') for k, v in al.items() if isinstance(v, dict) and 'level' in v}
    out[eid] = item
    print(eid, item['mag'], item['place'][:40], "contours" in item, "exposure" in item, flush=True)
    time.sleep(0.3)
json.dump(out, open('raw2/impact.json', 'w'), separators=(',', ':'))
print("DONE", len(out), os.path.getsize('raw2/impact.json'))
