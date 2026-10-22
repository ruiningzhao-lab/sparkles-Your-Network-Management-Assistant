// Checks the agenda pipeline without a server: the demo generator, the Today module builder
// and the description cleaner. Writes the generated data to fixtures/agenda/demo.json.
// Run: npm run check:agenda
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const entry = `
export { DemoSource } from '@/lib/agenda/demo';
export { buildToday } from '@/lib/agenda/build';
export { cleanDescription } from '@/lib/agenda/clean';
export { samplePeople, sampleHome } from '@/lib/demo/network';
`;
const out = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': root }, loader: { '.json': 'json' }, logLevel: 'error' });
const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { DemoSource, buildToday, cleanDescription, samplePeople, sampleHome } = mod;

// A fixed clock: Thursday Oct 22 2026, 9:45 in San Francisco (UTC-7).
process.env.TZ = 'America/Los_Angeles';
const now = new Date('2026-10-22T09:45:00-07:00');
const people = samplePeople();
const data = await new DemoSource().fetch({ people, home: sampleHome(), now, tzOffset: 420 });
const payload = { ...data, updatedAt: now.toISOString(), demo: true, canDemo: true, connected: false, defaultEvery: 45, replyHours: 24, waitDays: 5 };
const m = buildToday(payload, people, now.getTime());

assert.ok(m.meetings.length >= 3, 'meetings today');
assert.ok(m.next && new Date(m.next.start) - now <= 60 * 60e3, 'a meeting starts within the hour');
assert.ok(m.brief?.event.joinUrl?.includes('zoom.us'), 'brief has a Join link');
assert.ok(m.brief.event.description && !/Meeting ID|Passcode|One tap/i.test(m.brief.event.description), 'description is cleaned');
assert.ok(m.after, 'a meeting just ended, so the capture prompt shows');
assert.equal(m.needsReply.length, 3, 'needs reply');
assert.equal(m.waiting.length, 2, 'waiting on them');
assert.ok(m.due.some((f) => new Date(f.due) < new Date('2026-10-22T00:00:00-07:00')) && m.due.some((f) => f.due.startsWith('2026-10-23T00')), 'overdue and due today');
assert.ok(m.trips.length === 1 && m.trips[0].people.length >= 3, 'a trip to a city with 3+ people');
assert.equal(m.suggested.length, 2, 'suggested people');
assert.ok(m.notes.length >= 3, 'notes');
assert.ok(Object.values(m.lens).includes('meet') && Object.values(m.lens).includes('reply'), 'map lens kinds');
assert.ok(m.reconnect.length > 0 && m.reconnect.every((r) => r.days >= 45), 'reconnect uses the 45-day default');
const again = await new DemoSource().fetch({ people, home: sampleHome(), now, tzOffset: 420 });
assert.deepEqual(again, data, 'same seed, same script');

const c = (s) => cleanDescription(s);
assert.equal(c('<p>Join Zoom Meeting<br>https://zoom.us/j/1</p><p>Meeting ID: 1</p>').text, '');
assert.equal(c('Quick sync.\n\nJoin with Google Meet: https://meet.google.com/abc\nJoin by phone\n+1 402-555-0199').text, 'Quick sync.');
const teams = c('<div>Review the <a href="https://www.notion.so/x">deck</a>.</div><div>____________</div><div>Microsoft Teams meeting</div><div><a href="https://teams.microsoft.com/l/meetup-join/1">Click here to join</a></div><div><a href="https://aka.ms/JoinTeamsMeeting">Download Teams</a></div>');
assert.equal(teams.text, 'Review the deck.');
assert.deepEqual(teams.links, ['https://www.notion.so/x']);
assert.ok(teams.joinUrl.startsWith('https://teams.microsoft.com/'));
assert.equal(c('Agenda<br>--<br>Sent from my iPhone').text, 'Agenda');
assert.ok(c('word '.repeat(600)).text.length <= 2000);

mkdirSync(path.join(root, 'fixtures/agenda'), { recursive: true });
writeFileSync(path.join(root, 'fixtures/agenda/demo.json'), JSON.stringify({ now: now.toISOString(), tzOffset: 420, data }, null, 1) + '\n');
console.log(`agenda ok: ${m.meetings.length} meetings, ${m.needsReply.length} need a reply, ${m.due.length} due, trip to ${m.trips[0].city}. Wrote fixtures/agenda/demo.json`);
