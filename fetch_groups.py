import json, time, urllib.request, sys, os
UA = "RadarAroundYou-prototype/0.2 (contact: " + os.environ.get("CONTACT_EMAIL", "not set") + ")"
GROUPS = ["weather","resource","sar","sarsat","dmc","tdrss","argos","planet","spire","geo","intelsat","ses","eutelsat","telesat",
          "starlink","oneweb","qianfan","hulianwang","kuiper","iridium-NEXT","orbcomm","globalstar","amateur","satnogs","x-comm",
          "other-comm","gnss","gps-ops","glo-ops","galileo","beidou","sbas","science","geodetic","engineering","education",
          "military","radar","cubesat","stations","last-30-days","fengyun-1c-debris","iridium-33-debris","cosmos-2251-debris"]
def get(url, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception as e:
            print("  retry", i + 1, type(e).__name__, str(e)[:80], flush=True)
            time.sleep(8 * (i + 1))
    return None
for g in GROUPS:
    out = f"raw2/groups/{g}.json"
    if os.path.exists(out) and os.path.getsize(out) > 2:
        continue
    b = get(f"https://celestrak.org/satcat/records.php?GROUP={g}&FORMAT=json")
    if b is None:
        print("FAILED", g, flush=True); continue
    open(out, "wb").write(b)
    try:
        n = len(json.loads(b)); print(g, n, flush=True)
    except Exception:
        print(g, "non-json", b[:80], flush=True)
    time.sleep(3)
b = get("https://celestrak.org/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=json")
if b: open("raw2/gp_last30.json", "wb").write(b); print("gp last30", len(json.loads(b)))
print("DONE", flush=True)
