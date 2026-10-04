import { boot, startLater } from "./boot.js";
import { createOrbit } from "./orbit.js";
import { createSky } from "./sky.js";
import { createUnder } from "./under.js";

async function main() {
  const canvas = document.getElementById("gl");
  const app = await boot({ canvas });
  const orbit = createOrbit(app);
  const sky = createSky({ ...app, swarmGeo: orbit.swarmGeo });
  const under = createUnder(app);
  const params = new URLSearchParams(location.search);
  const city = app.D.cities[Number(params.get("city") || 0)];
  const place = { ...city, lat: Number(city.lat), lon: Number(city.lon) };
  orbit.setObserver({ lat: place.lat, lon: place.lon, name: city.name });
  sky.setPlace(city);
  const state = { view: "orbit" };
  function size() {
    const w = innerWidth, h = innerHeight;
    app.renderer.setSize(w, h, false);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    orbit.resize(w, h); sky.resize(w, h); under.resize(w, h);
  }
  size(); addEventListener("resize", size);
  orbit.flyTo(place.lat, place.lon, orbit.heroDist(), 10);
  let last = performance.now(), t0 = last;
  let offsetMs = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    app.clock.tick();
    const date = new Date(app.clock.now().getTime() + offsetMs);
    const tSec = (now - t0) / 1000;
    if (state.view === "orbit") {
      orbit.update(date, tSec, dt);
      app.renderer.render(orbit.scene, orbit.camera);
    } else if (state.view === "under") {
      under.update(date, tSec, dt);
      app.renderer.render(under.scene, under.camera);
    } else {
      sky.tickAnim(now);
      sky.update(date, tSec, dt);
      app.renderer.render(sky.scene, sky.camera);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__radar = { app, orbit, sky, under, place, state, ready: true, setOffset(ms) { offsetMs = ms; } };
  startLater(app).then(() => { window.__radar.later = true; });
}
main();
