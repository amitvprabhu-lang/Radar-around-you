// Links from the app to the content pages (site/), shown in the About screen on the real site. The addresses are relative to the app's
// own address, so they work wherever the site is hosted. They are shown only in the hosting build (build.mjs --site-pages), because the
// pages do not exist next to the app in the bundled preview. test/site.test.js checks that every link here has a page.
export const GUIDE_LINKS = [
  { group: "Sky reference", href: "moon-phases/", label: "Moon phases" },
  { group: "Sky reference", href: "eclipses/", label: "Eclipses" },
  { group: "Sky reference", href: "meteor-showers/", label: "Meteor showers" },
  { group: "Sky reference", href: "planets/", label: "Planets" },
  { group: "Sky reference", href: "seasons/", label: "Equinoxes and solstices" },
  { group: "Stars and places", href: "constellations/", label: "The 88 constellations" },
  { group: "Stars and places", href: "stars/", label: "Stars with official names" },
  { group: "Stars and places", href: "sky/", label: "Sky guides for six cities" },
  { group: "Guides", href: "guides/aurora/", label: "Reading an aurora forecast" },
  { group: "Guides", href: "guides/storms/", label: "Reading a hurricane forecast" },
  { group: "Guides", href: "guides/earthquakes/", label: "Reading earthquake data" },
  { group: "Guides", href: "guides/fires/", label: "What a fire detection is" },
  { group: "Guides", href: "guides/asteroids/", label: "Asteroid close approaches" },
  { group: "Guides", href: "guides/satellites/", label: "Seeing the ISS and satellites" },
  { group: "Guides", href: "methods/", label: "How we know" },
];
