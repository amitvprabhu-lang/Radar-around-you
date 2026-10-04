import json, time, urllib.request, urllib.error, os, math
from concurrent.futures import ThreadPoolExecutor
UA = "RadarAroundYou-prototype/0.2 (contact: " + os.environ.get("CONTACT_EMAIL", "not set") + ")"
snap = json.load(open('snapshot.json'))
def hav(a,b,c,d):
    p=math.pi/180; x=math.sin((c-a)*p/2)**2+math.cos(a*p)*math.cos(c*p)*math.sin((d-b)*p/2)**2
    return 2*6371*math.asin(math.sqrt(x))
want = []
for c in snap['cities']:
    ac = [a for a in c['planes']['aircraft'] if a['call']]
    ac.sort(key=lambda a: hav(c['lat'], c['lon'], a['lat'], a['lon']))
    want += [a['call'] for a in ac[:70]]
calls = list(dict.fromkeys(want))
out = json.load(open('raw2/routes.json')) if os.path.exists('raw2/routes.json') else {}
todo = [c for c in calls if c not in out or ('error' in out[c] and out[c]['error'] != 404)]
print("wanted", len(calls), "todo", len(todo), flush=True)
def one(cs):
    err = "?"
    for attempt in range(2):
        try:
            req = urllib.request.Request(f"https://api.adsb.lol/api/0/route/{cs}", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                return cs, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return cs, {"error": e.code}
        except Exception as e:
            err = str(e)[:50]; time.sleep(1.5)
    return cs, {"error": err}
done = 0
with ThreadPoolExecutor(max_workers=4) as ex:
    for cs, r in ex.map(one, todo):
        out[cs] = r; done += 1
        if done % 20 == 0:
            json.dump(out, open('raw2/routes.json', 'w')); print(done, flush=True)
json.dump(out, open('raw2/routes.json', 'w')); print("DONE", len(out), "ok", sum(1 for v in out.values() if 'error' not in v), flush=True)
