// Probe Overpass split-batch approach from Node.
const lat = 52.408;
const lon = -1.511;

const transportQuery = `[out:json][timeout:15];(
  node["railway"="station"](around:4000,${lat},${lon});
  node["railway"="halt"](around:4000,${lat},${lon});
  node["highway"="bus_stop"](around:700,${lat},${lon});
  way["leisure"="park"]["name"](around:2000,${lat},${lon});
  node["aeroway"="aerodrome"](around:50000,${lat},${lon});
  way["aeroway"="aerodrome"](around:50000,${lat},${lon});
);out center body;`;

const heritageQuery = `[out:json][timeout:15];(
  node["heritage"](around:800,${lat},${lon});
  node["historic"](around:800,${lat},${lon});
  way["historic"](around:800,${lat},${lon});
  way["heritage"](around:800,${lat},${lon});
);out center body;`;

const amenitiesQuery = `[out:json][timeout:15];(
  node["shop"="supermarket"]["name"](around:1200,${lat},${lon});
  node["amenity"="cafe"]["name"](around:800,${lat},${lon});
  node["amenity"="restaurant"]["name"](around:800,${lat},${lon});
  node["amenity"="pub"]["name"](around:800,${lat},${lon});
  node["amenity"="pharmacy"]["name"](around:1500,${lat},${lon});
);out center body;`;

const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  Accept: 'application/json',
  'User-Agent': 'UMU/1.0 (+https://umu.co)',
};

async function probe(name: string, query: string) {
  const t0 = Date.now();
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: HEADERS,
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(18000),
    });
    const ms = Date.now() - t0;
    const ct = res.headers.get('content-type') ?? '';
    if (!res.ok) return console.log(`${name.padEnd(10)} → ${res.status} ${ms}ms`);
    if (!ct.includes('json')) return console.log(`${name.padEnd(10)} → non-JSON ${ms}ms`);
    const data = (await res.json()) as any;
    console.log(`${name.padEnd(10)} → 200 ${ms}ms elements=${data.elements.length}`);
    return data.elements;
  } catch (e: any) {
    const ms = Date.now() - t0;
    console.log(`${name.padEnd(10)} → ERR ${ms}ms ${e?.message?.slice(0, 60)}`);
  }
}

(async () => {
  const [tr, he, am] = await Promise.all([
    probe('transport', transportQuery),
    probe('heritage', heritageQuery),
    probe('amenities', amenitiesQuery),
  ]);
  if (tr) {
    const trains = tr.filter(
      (e: any) => e.tags?.railway === 'station' || e.tags?.railway === 'halt',
    );
    const buses = tr.filter((e: any) => e.tags?.highway === 'bus_stop');
    console.log(`\nstations: ${trains.length}`);
    trains.slice(0, 4).forEach((e: any) => console.log(`  · ${e.tags?.name ?? '(unnamed)'}`));
    console.log(`bus stops: ${buses.length}`);
  }
})();
