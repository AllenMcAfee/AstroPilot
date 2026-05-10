// AstroPilot — Target Catalog
// ==============================
// Maps common deep-sky objects to their type, coordinates, and
// processing-relevant properties. This isn't meant to be exhaustive —
// it covers the objects most amateur astrophotographers actually shoot.
//
// Lookup is by name (fuzzy matched against common designations) or
// by RA/DEC proximity.

// ---------------------------------------------------------------------------
// Target taxonomy
// ---------------------------------------------------------------------------

const TYPES = {
   SPIRAL_GALAXY:      'spiral_galaxy',
   EDGE_ON_GALAXY:     'edge_on_galaxy',
   ELLIPTICAL_GALAXY:  'elliptical_galaxy',
   GALAXY_CLUSTER:     'galaxy_cluster',
   EMISSION_NEBULA:    'emission_nebula',
   PLANETARY_NEBULA:   'planetary_nebula',
   REFLECTION_NEBULA:  'reflection_nebula',
   DARK_NEBULA:        'dark_nebula',
   SUPERNOVA_REMNANT:  'supernova_remnant',
   GLOBULAR_CLUSTER:   'globular_cluster',
   OPEN_CLUSTER:       'open_cluster',
   MIXED_FIELD:        'mixed_field'
};

// ---------------------------------------------------------------------------
// Catalog entries
// ---------------------------------------------------------------------------
// Each entry: { names: [...], type, ra (hours), dec (degrees), size (arcmin), notes }

const CATALOG = [
   // --- Spiral Galaxies ---
   { names: ['M31', 'NGC 224', 'Andromeda Galaxy', 'Andromeda'], type: TYPES.SPIRAL_GALAXY, ra: 0.712, dec: 41.269, size: 190, notes: 'Large angular size, dust lanes, M32/M110 companions' },
   { names: ['M33', 'NGC 598', 'Triangulum Galaxy', 'Triangulum'], type: TYPES.SPIRAL_GALAXY, ra: 1.564, dec: 30.660, size: 73, notes: 'Face-on, low surface brightness, Ha regions' },
   { names: ['M51', 'NGC 5194', 'Whirlpool Galaxy', 'Whirlpool'], type: TYPES.SPIRAL_GALAXY, ra: 13.498, dec: 47.195, size: 11, notes: 'Interacting pair, prominent spiral arms' },
   { names: ['M81', 'NGC 3031', "Bode's Galaxy", 'Bodes Galaxy'], type: TYPES.SPIRAL_GALAXY, ra: 9.926, dec: 69.065, size: 27, notes: 'Bright core, smooth arms, IFN nearby' },
   { names: ['M101', 'NGC 5457', 'Pinwheel Galaxy', 'Pinwheel'], type: TYPES.SPIRAL_GALAXY, ra: 14.053, dec: 54.349, size: 29, notes: 'Face-on, asymmetric, Ha knots in arms' },
   { names: ['M63', 'NGC 5055', 'Sunflower Galaxy', 'Sunflower'], type: TYPES.SPIRAL_GALAXY, ra: 13.264, dec: 42.029, size: 13, notes: 'Flocculent spiral, tidal stream' },
   { names: ['M106', 'NGC 4258'], type: TYPES.SPIRAL_GALAXY, ra: 12.316, dec: 47.304, size: 19, notes: 'Active nucleus, anomalous arms' },
   { names: ['NGC 2403'], type: TYPES.SPIRAL_GALAXY, ra: 7.613, dec: 65.603, size: 22, notes: 'Nearby, many HII regions' },
   { names: ['NGC 6946', 'Fireworks Galaxy', 'Fireworks'], type: TYPES.SPIRAL_GALAXY, ra: 20.581, dec: 60.154, size: 11, notes: 'Face-on, heavy extinction, near galactic plane' },
   { names: ['M83', 'NGC 5236', 'Southern Pinwheel'], type: TYPES.SPIRAL_GALAXY, ra: 13.617, dec: -29.866, size: 13, notes: 'Barred spiral, starburst' },
   { names: ['M74', 'NGC 628', 'Phantom Galaxy', 'Phantom'], type: TYPES.SPIRAL_GALAXY, ra: 1.611, dec: 15.784, size: 10, notes: 'Perfect face-on grand design' },
   { names: ['M65', 'NGC 3623'], type: TYPES.SPIRAL_GALAXY, ra: 11.316, dec: 13.092, size: 10, notes: 'Leo Triplet member' },
   { names: ['M66', 'NGC 3627'], type: TYPES.SPIRAL_GALAXY, ra: 11.338, dec: 12.992, size: 9, notes: 'Leo Triplet member, asymmetric arms' },

   // --- Edge-on Galaxies ---
   { names: ['NGC 891'], type: TYPES.EDGE_ON_GALAXY, ra: 2.377, dec: 42.349, size: 14, notes: 'Classic edge-on, prominent dust lane' },
   { names: ['NGC 4565', 'Needle Galaxy', 'Needle'], type: TYPES.EDGE_ON_GALAXY, ra: 12.601, dec: 25.988, size: 16, notes: 'Thin profile, central bulge' },
   { names: ['NGC 4631', 'Whale Galaxy', 'Whale'], type: TYPES.EDGE_ON_GALAXY, ra: 12.700, dec: 32.541, size: 15, notes: 'Distorted, companion NGC 4627' },
   { names: ['NGC 5907', 'Splinter Galaxy', 'Splinter'], type: TYPES.EDGE_ON_GALAXY, ra: 15.265, dec: 56.329, size: 13, notes: 'Very thin, tidal streams' },
   { names: ['M82', 'NGC 3034', 'Cigar Galaxy', 'Cigar'], type: TYPES.EDGE_ON_GALAXY, ra: 9.927, dec: 69.681, size: 11, notes: 'Starburst, Ha outflows, pair with M81' },
   { names: ['M104', 'NGC 4594', 'Sombrero Galaxy', 'Sombrero'], type: TYPES.EDGE_ON_GALAXY, ra: 12.666, dec: -11.623, size: 9, notes: 'Prominent dust lane, large bulge' },

   // --- Elliptical Galaxies ---
   { names: ['M87', 'NGC 4486', 'Virgo A'], type: TYPES.ELLIPTICAL_GALAXY, ra: 12.514, dec: 12.391, size: 8, notes: 'Jet, globular cluster halo, Virgo Cluster core' },
   { names: ['M49', 'NGC 4472'], type: TYPES.ELLIPTICAL_GALAXY, ra: 12.497, dec: 8.000, size: 10, notes: 'Brightest Virgo Cluster member' },

   // --- Galaxy Clusters/Groups ---
   { names: ['Leo Triplet', 'M65 Group'], type: TYPES.GALAXY_CLUSTER, ra: 11.327, dec: 13.042, size: 60, notes: 'M65, M66, NGC 3628' },
   { names: ["Markarian's Chain", 'Markarians Chain'], type: TYPES.GALAXY_CLUSTER, ra: 12.450, dec: 13.167, size: 90, notes: 'Virgo Cluster chain' },
   { names: ["Stephan's Quintet", 'Stephans Quintet', 'NGC 7317 Group', 'HCG 92'], type: TYPES.GALAXY_CLUSTER, ra: 22.600, dec: 33.966, size: 4, notes: 'Compact group, tidal tails' },
   { names: ['Abell 426', 'Perseus Cluster'], type: TYPES.GALAXY_CLUSTER, ra: 3.330, dec: 41.512, size: 120, notes: 'Rich cluster around NGC 1275' },

   // --- Emission Nebulae ---
   { names: ['M42', 'NGC 1976', 'Orion Nebula', 'Great Orion Nebula', 'Orion'], type: TYPES.EMISSION_NEBULA, ra: 5.588, dec: -5.390, size: 85, notes: 'Extreme dynamic range, Trapezium core' },
   { names: ['M43', 'NGC 1982', "De Mairan's Nebula"], type: TYPES.EMISSION_NEBULA, ra: 5.593, dec: -5.267, size: 20, notes: 'M42 companion' },
   { names: ['NGC 2024', 'Flame Nebula', 'Flame'], type: TYPES.EMISSION_NEBULA, ra: 5.679, dec: -1.849, size: 30, notes: 'Near Alnitak, dark lane structure' },
   { names: ['IC 434', 'Horsehead Nebula', 'Horsehead', 'B33'], type: TYPES.EMISSION_NEBULA, ra: 5.689, dec: -2.458, size: 60, notes: 'Dark nebula silhouette against emission' },
   { names: ['M8', 'NGC 6523', 'Lagoon Nebula', 'Lagoon'], type: TYPES.EMISSION_NEBULA, ra: 18.063, dec: -24.383, size: 90, notes: 'Bright core, dark lanes, Hourglass region' },
   { names: ['M20', 'NGC 6514', 'Trifid Nebula', 'Trifid'], type: TYPES.EMISSION_NEBULA, ra: 18.040, dec: -23.033, size: 28, notes: 'Emission + reflection + dark lanes' },
   { names: ['M16', 'NGC 6611', 'Eagle Nebula', 'Eagle', 'Pillars of Creation'], type: TYPES.EMISSION_NEBULA, ra: 18.313, dec: -13.796, size: 35, notes: 'Pillars of Creation, star-forming' },
   { names: ['M17', 'NGC 6618', 'Omega Nebula', 'Swan Nebula', 'Omega', 'Swan'], type: TYPES.EMISSION_NEBULA, ra: 18.346, dec: -16.177, size: 46, notes: 'Bright emission, complex structure' },
   { names: ['NGC 7000', 'North America Nebula', 'North America'], type: TYPES.EMISSION_NEBULA, ra: 20.988, dec: 44.317, size: 120, notes: 'Very large, Ha dominant, Cygnus Wall' },
   { names: ['IC 5070', 'Pelican Nebula', 'Pelican'], type: TYPES.EMISSION_NEBULA, ra: 20.839, dec: 44.350, size: 60, notes: 'Companion to NGC 7000, ionization front' },
   { names: ['NGC 6960', 'Western Veil', 'Witch\'s Broom'], type: TYPES.SUPERNOVA_REMNANT, ra: 20.756, dec: 30.714, size: 70, notes: '52 Cygni region, filamentary' },
   { names: ['NGC 6992', 'NGC 6995', 'Eastern Veil'], type: TYPES.SUPERNOVA_REMNANT, ra: 20.939, dec: 31.717, size: 60, notes: 'Bright filaments, OIII strong' },
   { names: ['Veil Nebula', 'Cygnus Loop'], type: TYPES.SUPERNOVA_REMNANT, ra: 20.850, dec: 31.000, size: 180, notes: 'Full supernova remnant complex' },
   { names: ['IC 1396', 'Elephant Trunk Nebula', 'Elephant Trunk'], type: TYPES.EMISSION_NEBULA, ra: 21.629, dec: 57.500, size: 170, notes: 'Very large, Elephant Trunk globule' },
   { names: ['NGC 2237', 'NGC 2244', 'Rosette Nebula', 'Rosette'], type: TYPES.EMISSION_NEBULA, ra: 6.535, dec: 4.950, size: 80, notes: 'Ring shape, central cluster NGC 2244' },
   { names: ['NGC 2264', 'Cone Nebula', 'Christmas Tree Cluster', 'Cone'], type: TYPES.EMISSION_NEBULA, ra: 6.683, dec: 9.895, size: 20, notes: 'Cone + Fox Fur + Christmas Tree' },
   { names: ['M1', 'NGC 1952', 'Crab Nebula', 'Crab'], type: TYPES.SUPERNOVA_REMNANT, ra: 5.575, dec: 22.015, size: 7, notes: 'Pulsar-powered, filamentary' },
   { names: ['Sh2-129', 'Flying Bat Nebula', 'Flying Bat'], type: TYPES.EMISSION_NEBULA, ra: 21.183, dec: 60.167, size: 120, notes: 'Contains Ou4 Squid Nebula inside' },
   { names: ['Ou4', 'Squid Nebula', 'Squid', 'Giant Squid Nebula'], type: TYPES.EMISSION_NEBULA, ra: 21.190, dec: 59.950, size: 60, notes: 'Extremely faint OIII bipolar outflow' },
   { names: ['Sh2-240', 'Simeis 147', 'Spaghetti Nebula', 'Spaghetti'], type: TYPES.SUPERNOVA_REMNANT, ra: 5.667, dec: 28.000, size: 180, notes: 'Very large and faint, Ha filaments' },
   { names: ['NGC 1499', 'California Nebula', 'California'], type: TYPES.EMISSION_NEBULA, ra: 4.043, dec: 36.367, size: 145, notes: 'Large, Ha dominant, near Xi Persei' },
   { names: ['IC 1805', 'Heart Nebula', 'Heart'], type: TYPES.EMISSION_NEBULA, ra: 2.561, dec: 61.467, size: 60, notes: 'Ha dominant, Melotte 15 core' },
   { names: ['IC 1848', 'Soul Nebula', 'Soul', 'Westerhout 5', 'W5'], type: TYPES.EMISSION_NEBULA, ra: 2.852, dec: 60.433, size: 60, notes: 'Companion to Heart' },
   { names: ['NGC 3372', 'Carina Nebula', 'Carina', 'Eta Carinae Nebula'], type: TYPES.EMISSION_NEBULA, ra: 10.752, dec: -59.867, size: 120, notes: 'Southern, Eta Carinae, Keyhole' },
   { names: ['NGC 6888', 'Crescent Nebula', 'Crescent'], type: TYPES.EMISSION_NEBULA, ra: 20.200, dec: 38.350, size: 25, notes: 'Wolf-Rayet wind-blown bubble, OIII/Ha' },
   { names: ['NGC 2359', "Thor's Helmet", 'Thors Helmet'], type: TYPES.EMISSION_NEBULA, ra: 7.313, dec: -13.233, size: 10, notes: 'Wolf-Rayet bubble' },
   { names: ['M78', 'NGC 2068'], type: TYPES.REFLECTION_NEBULA, ra: 5.779, dec: 0.079, size: 8, notes: 'Bright reflection nebula in Orion' },
   { names: ['NGC 7023', 'Iris Nebula', 'Iris'], type: TYPES.REFLECTION_NEBULA, ra: 21.017, dec: 68.167, size: 18, notes: 'Blue reflection with surrounding dust' },
   { names: ['IC 2118', 'Witch Head Nebula', 'Witch Head'], type: TYPES.REFLECTION_NEBULA, ra: 5.083, dec: -7.233, size: 180, notes: 'Very faint, blue, near Rigel' },
   { names: ['M45', 'Pleiades', 'Seven Sisters'], type: TYPES.REFLECTION_NEBULA, ra: 3.791, dec: 24.105, size: 110, notes: 'Reflection nebulosity around stars, IFN' },

   // --- Dark Nebulae ---
   { names: ['B33', 'Horsehead'], type: TYPES.DARK_NEBULA, ra: 5.689, dec: -2.458, size: 6, notes: 'Iconic dark nebula silhouette' },
   { names: ['LDN 1622', 'Boogeyman Nebula', 'Boogeyman'], type: TYPES.DARK_NEBULA, ra: 5.903, dec: 1.833, size: 30, notes: 'Near Orion, dark cloud' },
   { names: ['B150', 'Seahorse Nebula', 'Seahorse'], type: TYPES.DARK_NEBULA, ra: 20.450, dec: 39.583, size: 30, notes: 'Dark nebula in Cygnus' },

   // --- Planetary Nebulae ---
   { names: ['M57', 'NGC 6720', 'Ring Nebula', 'Ring'], type: TYPES.PLANETARY_NEBULA, ra: 18.893, dec: 33.029, size: 1.4, notes: 'Classic ring shape, faint outer halo' },
   { names: ['M27', 'NGC 6853', 'Dumbbell Nebula', 'Dumbbell'], type: TYPES.PLANETARY_NEBULA, ra: 19.994, dec: 22.721, size: 8, notes: 'Large and bright, dual-lobed' },
   { names: ['NGC 7293', 'Helix Nebula', 'Helix'], type: TYPES.PLANETARY_NEBULA, ra: 22.493, dec: -20.837, size: 25, notes: 'Very large angular size, cometary knots' },
   { names: ['NGC 6826', 'Blinking Planetary'], type: TYPES.PLANETARY_NEBULA, ra: 19.744, dec: 50.525, size: 0.4, notes: 'Small, FLIER jets' },
   { names: ['NGC 7662', 'Blue Snowball'], type: TYPES.PLANETARY_NEBULA, ra: 23.432, dec: 42.539, size: 0.5, notes: 'Bright blue, nested shells' },
   { names: ['NGC 6543', "Cat's Eye Nebula", 'Cats Eye'], type: TYPES.PLANETARY_NEBULA, ra: 17.976, dec: 66.633, size: 0.3, notes: 'Complex inner structure, outer halo' },
   { names: ['NGC 2392', 'Eskimo Nebula', 'Clown Face Nebula'], type: TYPES.PLANETARY_NEBULA, ra: 7.486, dec: 20.912, size: 0.7, notes: 'Double-shell structure' },

   // --- Globular Clusters ---
   { names: ['M13', 'NGC 6205', 'Great Hercules Cluster', 'Hercules Cluster'], type: TYPES.GLOBULAR_CLUSTER, ra: 16.695, dec: 36.461, size: 20, notes: 'Northern showpiece, resolvable core' },
   { names: ['M3', 'NGC 5272'], type: TYPES.GLOBULAR_CLUSTER, ra: 13.703, dec: 28.377, size: 18, notes: 'Rich and symmetrical' },
   { names: ['M5', 'NGC 5904'], type: TYPES.GLOBULAR_CLUSTER, ra: 15.310, dec: 2.083, size: 23, notes: 'Old cluster, RR Lyrae stars' },
   { names: ['M92', 'NGC 6341'], type: TYPES.GLOBULAR_CLUSTER, ra: 17.285, dec: 43.136, size: 14, notes: 'Dense core, underrated' },
   { names: ['M22', 'NGC 6656'], type: TYPES.GLOBULAR_CLUSTER, ra: 18.607, dec: -23.905, size: 32, notes: 'Southern, loose core' },
   { names: ['M15', 'NGC 7078'], type: TYPES.GLOBULAR_CLUSTER, ra: 21.500, dec: 12.167, size: 18, notes: 'Core-collapsed' },
   { names: ['47 Tucanae', 'NGC 104', '47 Tuc'], type: TYPES.GLOBULAR_CLUSTER, ra: 0.402, dec: -72.081, size: 31, notes: 'Southern showpiece, near SMC' },
   { names: ['Omega Centauri', 'NGC 5139'], type: TYPES.GLOBULAR_CLUSTER, ra: 13.446, dec: -47.479, size: 36, notes: 'Largest Milky Way GC, possible dwarf galaxy core' },

   // --- Open Clusters ---
   { names: ['M35', 'NGC 2168'], type: TYPES.OPEN_CLUSTER, ra: 6.147, dec: 24.333, size: 28, notes: 'Rich, NGC 2158 nearby' },
   { names: ['NGC 869', 'NGC 884', 'Double Cluster', 'h and Chi Persei'], type: TYPES.OPEN_CLUSTER, ra: 2.333, dec: 57.133, size: 30, notes: 'Twin clusters, colorful stars' },
   { names: ['M44', 'NGC 2632', 'Beehive Cluster', 'Praesepe', 'Beehive'], type: TYPES.OPEN_CLUSTER, ra: 8.667, dec: 19.983, size: 95, notes: 'Large, naked-eye' },
   { names: ['M11', 'NGC 6705', 'Wild Duck Cluster', 'Wild Duck'], type: TYPES.OPEN_CLUSTER, ra: 18.851, dec: -6.267, size: 14, notes: 'Rich, dense, triangular shape' },
];

// ---------------------------------------------------------------------------
// Lookup functions
// ---------------------------------------------------------------------------

function normalize(name) {
   return name.replace(/[\s\-_']/g, '').toUpperCase();
}

function lookupByName(name) {
   const norm = normalize(name);

   // Exact match first
   for (const entry of CATALOG) {
      for (const n of entry.names) {
         if (normalize(n) === norm) return entry;
      }
   }

   // Substring match
   for (const entry of CATALOG) {
      for (const n of entry.names) {
         if (normalize(n).includes(norm) || norm.includes(normalize(n))) return entry;
      }
   }

   return null;
}

function angularDistance(ra1, dec1, ra2, dec2) {
   // Convert RA from hours to degrees
   const ra1d = ra1 * 15;
   const ra2d = ra2 * 15;
   const dec1r = dec1 * Math.PI / 180;
   const dec2r = dec2 * Math.PI / 180;
   const dra = (ra2d - ra1d) * Math.PI / 180;

   const a = Math.sin((dec2r - dec1r) / 2) ** 2 +
             Math.cos(dec1r) * Math.cos(dec2r) * Math.sin(dra / 2) ** 2;
   return 2 * Math.asin(Math.sqrt(a)) * 180 / Math.PI; // degrees
}

function lookupByCoordinates(ra, dec, maxDistanceDeg) {
   if (typeof maxDistanceDeg === 'undefined') maxDistanceDeg = 1.0;

   let best = null;
   let bestDist = Infinity;

   for (const entry of CATALOG) {
      const dist = angularDistance(ra, dec, entry.ra, entry.dec);
      if (dist < maxDistanceDeg && dist < bestDist) {
         best = entry;
         bestDist = dist;
      }
   }

   return best ? { entry: best, distance: bestDist } : null;
}

// Parse RA string formats: "05h 35m 17s", "05:35:17", or decimal hours
function parseRA(raw) {
   if (typeof raw === 'number') return raw;
   const s = String(raw).trim();

   // HH:MM:SS or HHhMMmSSs
   const hms = s.match(/(\d+)[h:\s]+(\d+)[m:\s]+(\d+\.?\d*)/);
   if (hms) return parseFloat(hms[1]) + parseFloat(hms[2]) / 60 + parseFloat(hms[3]) / 3600;

   return parseFloat(s);
}

// Parse DEC string formats: "+41d 16' 09\"", "+41:16:09", or decimal degrees
function parseDEC(raw) {
   if (typeof raw === 'number') return raw;
   const s = String(raw).trim();

   const dms = s.match(/([+-]?\d+)[d°:\s]+(\d+)['m:\s]+(\d+\.?\d*)/);
   if (dms) {
      const sign = s.startsWith('-') ? -1 : 1;
      return sign * (Math.abs(parseFloat(dms[1])) + parseFloat(dms[2]) / 60 + parseFloat(dms[3]) / 3600);
   }

   return parseFloat(s);
}

module.exports = { CATALOG, TYPES, lookupByName, lookupByCoordinates, parseRA, parseDEC };
