import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createState, start, step, dispatch, verify, correct, dismiss, broadcast, finish, debrief, route, edgeKey, remaining, totalPopulation, availableCapacity, linkDown, scout, respondRoad, estimateTrip, dispatchArea, assessment, waterRoute, evacuationPlan, radioMessageRelevant } from '../src/engine.js';
const level = JSON.parse(await readFile(new URL('../data/level.json', import.meta.url)));
const mission = () => { const s = createState(level); start(s); return s; };
const advance = (s, to) => step(s, Math.max(0, to - s.time));
const get = (s, id) => s.events.find(e => e.id === id);

test('authored level has valid references, unique reports, and a six-minute arc', () => {
  const ids = new Set(level.events.map(e => e.id));
  assert.equal(ids.size, level.events.length);
  assert.equal(level.duration, 360);
  for (const e of level.events) {
    for (const view of [e.ai, e.truth]) assert.ok(level.blocks.some(b => b.id === view.block));
    assert.ok(e.at >= 0 && e.at < level.duration);
    assert.ok(e.ai.confidence >= 0 && e.ai.confidence <= 100);
    if (e.truth.duplicateOf) assert.ok(ids.has(e.truth.duplicateOf));
  }
});
test('time and flood continue with no pause state; idle run conserves population', () => {
  const s = mission();
  assert.equal('paused' in s, false);
  step(s, 360);
  assert.equal(s.ended, true);
  assert.equal(s.saved + s.lost, totalPopulation(s));
  assert.ok(s.lost > 0);
  assert.ok(s.shelters.every(x => x.used <= x.capacity && x.reserved === 0));
});
test('dispatch occupies a unit, reserves capacity, and credits only at reception', () => {
  const s = mission(); s.blocks.forEach(b => b.walkers = 0);
  const timing = estimateTrip(s, s.units[0], 'A1', 'S1');
  assert.equal(dispatch(s, 'R01', 'SK-01', 'S1').ok, true);
  assert.equal(s.units[0].status, 'outbound');
  assert.equal(s.shelters[0].reserved, 16);
  assert.equal(dispatch(s, 'R01', 'SK-02', 'S1').ok, false);
  advance(s, timing.outbound + 1);
  assert.equal(get(s, 'R01').rescued, 8);
  assert.equal(s.saved, 0);
  advance(s, timing.total + 2);
  assert.ok(s.saved >= 8);
  assert.equal(s.units[0].status, 'ready');
  assert.equal(get(s, 'R01').status, 'rescued');
});
test('rescue boats tow to a ramp, launch only into connected floodwater, and return by trailer', () => {
  const s = mission(), boat = s.units.find(u => u.id === 'SK-01');
  assert.equal(estimateTrip(s, boat, 'A4', 'S1'), null);
  assert.ok(dispatch(s, 'R01', boat.id, 'S1').ok);
  assert.equal(boat.trip.stage, 'trailer-out'); assert.equal(boat.trip.mode, 'trailer'); assert.equal(boat.trip.launch, 'A1');
  const trailerEnd = boat.trip.ends; advance(s, trailerEnd + .5); assert.equal(boat.trip.stage, 'launch');
  advance(s, boat.trip.ends + .5); assert.equal(boat.trip.stage, 'water-out'); assert.equal(boat.trip.mode, 'water');
  assert.ok(waterRoute(s, 'A1', 'D1'));
  s.closedRoads.push(edgeKey('B1', 'C1'));
  assert.ok(waterRoute(s, 'A1', 'D1'));
});
test('ten drones have outbound, scan and return occupancy', () => {
  const s = mission();
  assert.equal(s.drones.length, 10);
  for (const d of s.drones) assert.ok(scout(s,'A4',d.id).ok);
  assert.equal(s.drones.filter(d=>d.status==='ready').length,0);
  assert.equal(scout(s,'B4','DR-01').ok,false);
  advance(s,20);
  assert.ok(s.drones.every(d=>d.status==='return'));
  advance(s,25);
  assert.ok(s.drones.every(d=>d.status==='ready'));
  advance(s,130);assert.ok(verify(s,'R06','DR-01').ok);
  advance(s,149.5);assert.equal(get(s,'R06').verified,false);
  advance(s,150);assert.equal(get(s,'R06').verified,true);
  assert.equal(get(s,'R06').truth.people,12);
});
test('wrong position costs a sortie; correction changes the physical destination', () => {
  const s = mission(); s.settings.aggregate = true; advance(s, 202);
  assert.ok(dispatch(s, 'R11', 'AL-01', 'S2').ok);
  advance(s, 232);
  assert.equal(get(s, 'R11').rescued, 0);
  assert.equal(get(s, 'R11').status, 'missed');
  assert.ok(correct(s, 'R11', { block: 'C3', severity: 'high' }).ok);
  assert.ok(dispatch(s, 'R11', 'AL-01', 'S2').ok);
  advance(s, 260);
  assert.equal(get(s, 'R11').rescued, 9);
  assert.equal(s.bonus, 25);
});
test('dismissing real residents does not make them safe or remove flood consequences', () => {
  const s = mission(); dismiss(s, 'R01');
  advance(s, 125);
  assert.equal(get(s, 'R01').lost, 8);
  assert.equal(get(s, 'R01').rescued, 0);
  assert.equal(s.bonus, 0);
});
test('archiving a contextual false positive grants the correction bonus only at debrief', () => {
  const s = mission(); s.settings.aggregate = true; advance(s, 118);
  assert.ok(dismiss(s, 'R07').ok); assert.equal(s.bonus, 0);
  finish(s); assert.equal(s.bonus, 25);
  assert.equal(debrief(s).corrections, 1);
});
test('duplicate deliveries cannot create residents or double-credit rescue', () => {
  const s = mission(); advance(s, 216);
  assert.ok(dispatch(s, 'R12', 'SK-02', 'S2').ok);
  assert.ok(dispatch(s, 'R13', 'AL-01', 'S2').ok);
  advance(s, 259);
  assert.equal(get(s, 'R12').rescued, 7);
  assert.equal(remaining(s, get(s, 'R13')), 0);
  finish(s);
  assert.equal(s.saved + s.lost, totalPopulation(s));
});
test('guidance accelerates walking evacuation and reserves hub capacity', () => {
  const a = mission(), b = mission();
  assert.ok(broadcast(a, 'A1', 'S2').ok);
  advance(a, 47); advance(b, 47);
  assert.equal(a.blocks[0].walkers, 0);
  assert.ok(b.blocks[0].walkers > 0);
  assert.ok(a.shelters[1].reserved > 0);
  assert.equal(a.broadcasts, 1);
});
test('closed corridors reroute skiffs and capacity reservations prevent overbooking', () => {
  const s = mission();
  s.closedRoads.push(edgeKey('B2', 'B3'));
  const p = route(s, 'B2', 'S2');
  assert.ok(p && p.length > 4);
  assert.equal(p.some((x, i) => i && edgeKey(p[i - 1], x) === edgeKey('B2', 'B3')), false);
  s.shelters[0].used = s.shelters[0].capacity - 8;
  assert.equal(availableCapacity(s.shelters[0]), 8);
  assert.equal(dispatch(s, 'R01', 'SK-01', 'S1').ok, false);
});
test('outage and restoration are scripted, and repeated advances stay deterministic', () => {
  const a = mission(), b = mission();
  advance(a, 201); assert.equal(linkDown(a), true);
  assert.ok(a.closedRoads.length);
  advance(a, 261); assert.equal(linkDown(a), false); assert.ok(a.closedRoads.includes(edgeKey('B2','B3')));
  advance(a, 360);
  for (let i = 0; i < 1440; i++) step(b, .25);
  assert.equal(a.saved, b.saved); assert.equal(a.lost, b.lost);
  assert.deepEqual(a.shelters, b.shelters);
});
test('radio noise filtering follows the selected unit category', () => {
  const s = mission(); advance(s, 38);
  const road = s.feed.find(message => message.roadId === 'RD1');
  const coastalReport = s.feed.find(message => message.eventId === 'R01');
  const noise = s.feed.find(message => message.noise);
  assert.equal(radioMessageRelevant(s, noise, 'ground'), false);
  assert.equal(radioMessageRelevant(s, road, 'ground'), true);
  assert.equal(radioMessageRelevant(s, road, 'drone'), false);
  assert.equal(radioMessageRelevant(s, coastalReport, 'skiff'), true);
  assert.equal(radioMessageRelevant(s, coastalReport, 'air'), true);
});
test('rescue boat filtering keeps only people and water-related traffic', () => {
  const s = mission();
  assert.equal(radioMessageRelevant(s, { eventId: 'R01' }, 'skiff'), true);
  assert.equal(radioMessageRelevant(s, { eventId: 'R06' }, 'skiff'), false);
  assert.equal(radioMessageRelevant(s, { text: 'Link stable. Reception hubs are open.' }, 'skiff'), false);
  assert.equal(radioMessageRelevant(s, { text: 'Waterline rising beside the ferry pier.' }, 'skiff'), true);
  const empty = get(s, 'R01');
  empty.source.people = 0;
  assert.equal(radioMessageRelevant(s, { eventId: 'R01' }, 'skiff'), false);
});
test('a corridor failure reroutes a skiff that is already moving', () => {
  const s = mission(); advance(s, 118);
  assert.ok(dispatch(s, 'R07', 'SK-01', 'S2').ok);
  const unit = s.units[0], oldPath = unit.trip.path.slice();
  const lastEdge = edgeKey(oldPath.at(-2), oldPath.at(-1));
  s.closedRoads.push(lastEdge);
  step(s, .25);
  assert.equal(unit.trip.path.some((x, i) => i && edgeKey(unit.trip.path[i - 1], x) === lastEdge), false);
  assert.ok(s.feed.some(f => f.text.includes('Rerouting')));
});
test('completed shifts reject further mutations', () => {
  const s = mission(); finish(s);
  const before = JSON.stringify(s);
  for (const result of [dispatch(s, 'R01', 'SK-01', 'S1'), verify(s, 'R01'), dismiss(s, 'R01'), correct(s, 'R01', { block: 'A1' }), broadcast(s, 'A1', 'S1')]) assert.equal(result.ok, false);
  assert.equal(JSON.stringify(s), before);
});

test('all AI functions start off and manual dispatch uses the direct source',()=>{
  const s=mission();assert.ok(Object.values(s.settings).every(v=>v===false));advance(s,202);
  assert.equal(assessment(s,get(s,'R11')).block,'C3');
  assert.ok(dispatch(s,'R11','AL-01','S2').ok);
  assert.equal(s.decisions.at(-1).action,'manual');advance(s,245);assert.equal(get(s,'R11').rescued,9);
});
test('only ground crews can clear road incidents and remain occupied through return',()=>{
  const s=mission();advance(s,38);
  assert.equal(respondRoad(s,'RD1','AL-01').ok,false);
  assert.ok(respondRoad(s,'RD1','GT-01').ok);
  assert.ok(s.closedRoads.includes(edgeKey('B1','C1')));
  const u=s.units.find(u=>u.id==='GT-01');
  advance(s,u.trip.ends+.1);assert.equal(u.status,'working');
  advance(s,u.trip.ends+.1);assert.equal(u.status,'return');
  assert.equal(s.closedRoads.includes(edgeKey('B1','C1')),false);
  advance(s,u.trip.ends+.1);assert.equal(u.status,'ready');
});
test('road congestion adds surface travel time and repair removes it',()=>{
  const s=mission();advance(s,214);const u=s.units.find(u=>u.id==='GT-01');u.position='C3';
  const busy=estimateTrip(s,u,'D3','S3').outbound;
  s.roadIncidents.find(r=>r.id==='RD3').status='cleared';
  const free=estimateTrip(s,u,'D3','S3').outbound;
  assert.equal(busy-free,8);
});
test('dispatching a category to an empty area returns the vehicle and reservation',()=>{
  const s=mission();s.blocks.forEach(b=>b.walkers=0);assert.ok(dispatchArea(s,'D4','GT-02','S3').ok);const u=s.units.find(u=>u.id==='GT-02');
  advance(s,20);assert.equal(u.status,'ready');assert.equal(u.reservation,0);assert.equal(s.shelters[2].reserved,0);
});


test('shelter display semantics distinguish inbound reservations from residents actually received',()=>{
  const s=mission();s.blocks.forEach(b=>b.walkers=0);const u=s.units.find(u=>u.id==='GT-01');
  const timing=estimateTrip(s,u,'A1','S1');
  assert.ok(dispatch(s,'R01',u.id,'S1').ok);
  assert.equal(s.shelters[0].used,0);
  assert.equal(s.shelters[0].reserved,8);
  advance(s,timing.outbound+.1);
  assert.equal(s.shelters[0].used,0);
  assert.equal(s.shelters[0].reserved,8);
  advance(s,timing.total+.5);
  assert.equal(s.shelters[0].used,8);
  assert.equal(s.shelters[0].reserved,0);
  assert.ok(s.saved>=8);
});

test('ground-team authoritative position advances along its route while it is moving',()=>{
  const s=mission(),u=s.units.find(u=>u.id==='GT-01');
  assert.ok(dispatchArea(s,'A1',u.id,'S1').ok);
  assert.ok(u.trip.path.length>2);
  const start=u.position,mid=u.trip.started+(u.trip.ends-u.trip.started)*.6;
  advance(s,mid);
  assert.equal(u.status,'outbound');
  assert.notEqual(u.position,start);
  assert.ok(u.trip.path.includes(u.position));
});


test('automatic evacuation uses nearest reachable hubs, including Summit Hub and West Ridge',()=>{
  const s=mission();
  assert.equal(evacuationPlan(s,'B4').shelter.id,'S2');
  assert.equal(evacuationPlan(s,'A3').shelter.id,'S4');
  advance(s,40);
  const summit=s.shelters.find(x=>x.id==='S2'),ridge=s.shelters.find(x=>x.id==='S4');
  assert.ok(summit.used>0,'Summit Hub should receive real evacuees');
  assert.ok(ridge.used>0,'West Ridge should receive real evacuees');
  assert.ok(summit.used+summit.reserved>0);
  assert.ok(ridge.used+ridge.reserved>0);
});
