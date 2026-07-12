// Fetches the next upcoming plan for a given Planning Center Services
// service type, pulls each song's arrangement BPM, and writes data.json.
//
// Required environment variables (set as GitHub Actions secrets):
//   PCO_APP_ID           - Personal Access Token "Application ID"
//   PCO_SECRET           - Personal Access Token "Secret"
//   PCO_SERVICE_TYPE_ID  - the numeric ID of your Service Type
//                          (find it in the URL when viewing that
//                          service type's plans in Planning Center)

import fs from 'fs';

const APP_ID = process.env.PCO_APP_ID;
const SECRET = process.env.PCO_SECRET;
const SERVICE_TYPE_ID = process.env.PCO_SERVICE_TYPE_ID;

if (!APP_ID || !SECRET || !SERVICE_TYPE_ID) {
  console.error('Missing PCO_APP_ID, PCO_SECRET, or PCO_SERVICE_TYPE_ID env vars.');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${APP_ID}:${SECRET}`).toString('base64');

async function pco(path) {
  const res = await fetch(`https://api.planningcenteronline.com${path}`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) {
    throw new Error(`PCO API error ${res.status} on ${path}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  // 1. Find the next upcoming plan for this service type.
  const plansRes = await pco(
    `/services/v2/service_types/${SERVICE_TYPE_ID}/plans?filter=future&order=sort_date&per_page=1`
  );
  const plan = plansRes.data[0];

  if (!plan) {
    console.log('No upcoming plan found.');
    fs.writeFileSync(
      'data.json',
      JSON.stringify({ updated: new Date().toISOString(), planTitle: null, songs: [] }, null, 2)
    );
    return;
  }

  // 2. Get ALL of the plan's items (songs, headers, media, etc.), including
  //    song + arrangement data for BPM where it applies.
  const itemsRes = await pco(
    `/services/v2/service_types/${SERVICE_TYPE_ID}/plans/${plan.id}/items?include=song,arrangement&per_page=200&order=sequence`
  );

  const included = itemsRes.included || [];
  const arrangementsById = Object.fromEntries(
    included.filter((i) => i.type === 'Arrangement').map((a) => [a.id, a])
  );

  const items = itemsRes.data.map((item) => {
    const isSong = item.attributes.item_type === 'song';
    const arrId = isSong ? item.relationships?.arrangement?.data?.id : null;
    const arrangement = arrId ? arrangementsById[arrId] : null;
    const bpm = arrangement?.attributes?.bpm;
    return {
      id: item.id,
      type: item.attributes.item_type, // "song", "header", "media", "other", ...
      title: item.attributes.title,
      bpm: bpm ? Number(bpm) : null,
    };
  });

  const songs = items.filter((i) => i.type === 'song');

  fs.writeFileSync(
    'data.json',
    JSON.stringify(
      {
        updated: new Date().toISOString(),
        planId: plan.id,
        planTitle: plan.attributes.title || plan.attributes.dates || null,
        planDate: plan.attributes.sort_date || null,
        items,
        songs,
      },
      null,
      2
    )
  );

  console.log(`Synced ${items.length} item(s) (${songs.length} songs) from plan "${plan.attributes.title}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
