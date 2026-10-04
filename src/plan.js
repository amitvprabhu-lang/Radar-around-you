// "Best time tonight": scores the next 13 hours for stargazing from a place, using the Sun's altitude,
// the Moon (altitude and lit fraction), the cloud forecast for the place and the aurora chance.
import * as Astro from "astronomy-engine";
import { sunAltAz, bestWindow } from "./core.js";

export function cloudAtHour(clouds, date) {
  const hrs = clouds && clouds.hours;
  if (!hrs) return null;
  let best = null;
  for (const hr of hrs) {
    const dt = Math.abs(Date.parse(hr.t) - date.getTime());
    if (dt <= 90 * 60000 && (!best || dt < best.dt)) best = { dt, cloud: hr.cloud };
  }
  return best ? best.cloud : null;
}

export function tonightPlan(place, now, auroraChance = 0) {
  const start = new Date(Math.ceil(now.getTime() / 3600000) * 3600000);
  const obs = new Astro.Observer(place.lat, place.lon, 0);
  const hours = [];
  for (let i = 0; i < 13; i++) {
    const t = new Date(start.getTime() + i * 3600000);
    const eq = Astro.Equator(Astro.Body.Moon, t, obs, true, true);
    const hz = Astro.Horizon(t, obs, eq.ra, eq.dec, "normal");
    const cloud = cloudAtHour(place.clouds, t);
    hours.push({ t, sunAlt: sunAltAz(place.lat, place.lon, t).alt, moonAlt: hz.altitude, moonFrac: Astro.Illumination(Astro.Body.Moon, t).phase_fraction, cloud: cloud ?? 50, cloudKnown: cloud != null, aurora: auroraChance });
  }
  return { ...bestWindow(hours), hours };
}
