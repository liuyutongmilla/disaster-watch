// Pure, deterministic simulation. Rendering and audio never advance the clock.
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const isOpen = e => ['new', 'verified', 'missed'].includes(e.status);
export const point = id => {
  if (id.startsWith('S')) {
    const shelterPoints = {
      S1:{x:.35,y:4.25}, S2:{x:1.5,y:4.35}, S3:{x:2.65,y:4.25},
      S4:{x:-.55,y:2.15}
    };
    return shelterPoints[id] || { x: 1.5, y: 4.25 };
  }
  return { x: id.charCodeAt(0) - 65, y: Number(id[1]) - 1 };
};
const distance = (a, b) => Math.hypot(point(a).x - point(b).x, point(a).y - point(b).y);
export const edgeKey = (a, b) => [a, b].sort().join(':');

export function route(state, from, to) {
  if (from === to) return [from];
  const nodes = [...state.blocks.map(b => b.id), ...state.shelters.map(s => s.id)];
  const neighbors = id => {
    if (id.startsWith('S')) return ({ S1: ['A4'], S2: ['B4', 'C4'], S3: ['D4'], S4: ['A3'] })[id];
    const p = point(id);
    const near = nodes.filter(n => !n.startsWith('S') && Math.abs(point(n).x - p.x) + Math.abs(point(n).y - p.y) === 1);
    if (id === 'A4') near.push('S1');
    if (id === 'B4' || id === 'C4') near.push('S2');
    if (id === 'D4') near.push('S3');
    if (id === 'A3') near.push('S4');
    return near;
  };
  const queue = [[from]], visited = new Set([from]);
  while (queue.length) {
    const path = queue.shift();
    for (const next of neighbors(path.at(-1)) || []) {
      if (visited.has(next) || state.closedRoads.includes(edgeKey(path.at(-1), next))) continue;
      if (next === to) return [...path, next];
      visited.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

export const launchSites = ['A1', 'D1'];
export const waterAccessible = (state, id) => !id.startsWith('S') && (point(id).y === 0 || point(id).y <= floodRow(state) + .85);
export function waterRoute(state, from, to) {
  if (!waterAccessible(state, from) || !waterAccessible(state, to)) return null;
  if (from === to) return [from];
  const nodes = state.blocks.map(b => b.id).filter(id => waterAccessible(state, id));
  const queue = [[from]], visited = new Set([from]);
  while (queue.length) {
    const path = queue.shift(), p = point(path.at(-1));
    for (const next of nodes.filter(id => Math.abs(point(id).x - p.x) + Math.abs(point(id).y - p.y) === 1)) {
      if (visited.has(next)) continue;
      if (next === to) return [...path, next];
      visited.add(next); queue.push([...path, next]);
    }
  }
  return null;
}

export function createState(level) {
  return {
    level, time: 0, started: false, ended: false, speed: 1,
    selected: null, selectedBlock: 'A1', selectedUnit: 'GT-01', selectedKind: 'ground', selectedShelter: 'S1',
    settings: { aggregate: false, filter: false, routes: false, calls: false },
    blocks: level.blocks.map(b => ({ ...b, walkers: b.walkers, guided: null, evacuated: 0, lost: 0 })),
    events: level.events.map(e => ({ ...structuredClone(e), status: 'pending', verified: false, correction: null, scan: 0, attempts: 0, decision: null, rescued: 0, lost: 0, dismissed: false })),
    shelters: level.shelters.map(s => ({ ...s, used: 0, reserved: 0 })),
    units: level.units.map(u => ({ ...u, status: 'ready', position: u.home, trip: null, cargo: 0 })),
    drones: Array.from({ length: level.droneCount || 10 }, (_, i) => ({ id: `DR-${String(i + 1).padStart(2, '0')}`, kind: 'drone', event: null, until: 0, status: 'ready', position: 'S2', trip: null })),
    roadIncidents: (level.roadIncidents || []).map(r => ({ ...structuredClone(r), status: 'pending' })),
    colleagues: [], lastColleague: -1, selectedRoad: null,
    closedRoads: [], feed: [], decisions: [], outcomes: [], convoys: [],
    saved: 0, lost: 0, bonus: 0, broadcasts: 0, noiseIndex: -1, evacTick: 0,
    notices: [], nextFeedId: 1, lastPhase: -1, lastSystem: -1, urgentIndex: -1,
  };
}

export const phaseAt = state => state.time < 110 ? 'BASELINE' : state.time < 200 ? 'BLIND SPOTS' : state.time < 260 ? 'LINK DEGRADED' : 'RECOVERY';
export const linkDown = state => state.time >= 200 && state.time < 260;
export const floodRow = state => {
  const keys = [[0, -1.1], [30, -0.85], [110, 0.2], [200, 1.4], [260, 2.2], [360, 3.65]];
  for (let i = 1; i < keys.length; i++) if (state.time <= keys[i][0]) {
    const [t, y] = keys[i - 1], [t2, y2] = keys[i];
    return y + (y2 - y) * (state.time - t) / (t2 - t);
  }
  return 3.65;
};
export const submerged = (state, id) => point(id).y < floodRow(state) - 0.35;
export const judgment = event => event.correction || (event.verified ? event.truth : event.ai);
export const assessment = (state, event) => event.correction || (event.verified ? event.truth : state.settings.aggregate ? event.ai : event.source || event.ai);
export const aiCorrect = e => e.ai.block === e.truth.block && e.ai.severity === e.truth.severity && (e.ai.people > 0) === (e.truth.people > 0) && !e.truth.duplicateOf;
export const canonical = (state, e) => e.truth.duplicateOf ? state.events.find(x => x.id === e.truth.duplicateOf) : e;
export const remaining = (state, e) => {
  const c = canonical(state, e);
  return Math.max(0, c.truth.people - c.rescued - c.lost);
};
export const availableCapacity = s => Math.max(0, s.capacity - s.used - s.reserved);

// One authoritative shelter-selection rule for both simulation and rendering.
// Guided walkers keep the player's chosen hub when it is still reachable and has
// room. Everyone else uses the shortest currently-open route to a hub with space;
// ties prefer the less-loaded hub. This prevents S2/S4 from being bypassed by the
// old hard-coded west/east split.
export function evacuationPlan(state, blockId, preferredId = null) {
  const preferred = preferredId || state.blocks.find(b => b.id === blockId)?.guided || null;
  const candidates = state.shelters.map(shelter => {
    const path = availableCapacity(shelter) > 0 ? route(state, blockId, shelter.id) : null;
    return path ? { shelter, path, load: (shelter.used + shelter.reserved) / Math.max(1, shelter.capacity) } : null;
  }).filter(Boolean);
  if (!candidates.length) return null;
  if (preferred) {
    const chosen = candidates.find(x => x.shelter.id === preferred);
    if (chosen) return chosen;
  }
  candidates.sort((a, b) => a.path.length - b.path.length || a.load - b.load || a.shelter.id.localeCompare(b.shelter.id));
  return candidates[0];
}

export const totalPopulation = state => state.level.blocks.reduce((n, b) => n + b.walkers, 0) + state.events.filter(e => !e.truth.duplicateOf).reduce((n, e) => n + e.truth.people, 0);

function feed(state, channel, text, eventId = null, noise = false, urgent = false, metadata = {}) {
  state.feed.unshift({ id: state.nextFeedId++, time: state.time, channel, text, eventId, noise, urgent, ...metadata });
  state.feed = state.feed.slice(0, 100);
}
const WATER_RELEVANCE = /\b(water|waterline|flood|flooded|harbor|harbour|dock|pier|ferry|boat|skiff|bay|shore|shoreline|seawall|marina|wharf|quay|tide)\b/i;
const waterReportRelevant = (state, event, message) => {
  const view = assessment(state, event);
  if (view.people <= 0) return false;
  const block = state.blocks.find(b => b.id === view.block);
  const context = [
    message.text,
    event.title,
    event.raw,
    event.sensor,
    event.ai?.summary,
    event.ai?.reason,
    event.verified ? event.reveal : '',
    block?.name,
    block?.type
  ].filter(Boolean).join(' ');
  return point(view.block).y === 0 || WATER_RELEVANCE.test(context);
};
export function radioMessageRelevant(state, message, kind) {
  if (message.noise) return false;
  if (message.unitKind) return message.unitKind === kind;
  if (message.roadId) return kind === 'ground';
  if (!message.eventId) return kind !== 'skiff' || WATER_RELEVANCE.test(message.text || '');
  const event = state.events.find(e => e.id === message.eventId);
  if (!event || kind === 'air' || kind === 'drone') return true;
  if (kind === 'skiff') return waterReportRelevant(state, event, message);
  const block = assessment(state, event).block;
  if (kind === 'ground') return !submerged(state, block);
  return false;
}
export function notice(state, text, type = 'info') {
  state.notices.push({ id: state.nextFeedId++, time: state.time, text, type });
  state.notices = state.notices.slice(-5);
}
export function start(state) {
  state.started = true;
  feed(state, 'network', 'Colony warning broadcast complete. Residents are moving inland. Reception hubs are open.');
  notice(state, 'Select a report, read its evidence, then assign a rescue unit.');
  step(state, 0);
}

export function verify(state, eventId, droneId) {
  if (!state.started || state.ended) return { ok: false, message: 'There is no active shift.' };
  const e = state.events.find(e => e.id === eventId);
  if (!e || !isOpen(e) || e.verified || e.scan) return { ok: false, message: 'This report cannot be scanned.' };
  const drone = state.drones.find(d => (!droneId || d.id === droneId) && d.status === 'ready');
  if (!drone) return { ok: false, message: 'No reconnaissance drone is ready. Wait for a return flight.' };
  drone.event = e.id;
  drone.status = 'scanning';
  drone.position = 'S2';
  drone.trip = { from: 'S2', to: assessment(state, e).block, path: ['S2', assessment(state, e).block], started: state.time, ends: state.time + 5, stage: 'outbound' };
  drone.until = state.time + state.level.droneSeconds;
  e.scan = drone.until;
  state.decisions.push({ time: state.time, event: e.id, condition: e.condition, action: 'verify', aiCorrect: aiCorrect(e) });
  notice(state, `${drone.id} dispatched to check ${e.title}.`);
  return { ok: true };
}

export function correct(state, eventId, patch) {
  if (!state.started || state.ended) return { ok: false, message: 'There is no active shift.' };
  const e = state.events.find(e => e.id === eventId);
  if (!e || !isOpen(e) || !state.blocks.some(b => b.id === patch.block)) return { ok: false, message: 'Choose an active report and valid sector.' };
  e.correction = { ...assessment(state, e), ...patch };
  notice(state, `Your assessment is set for ${patch.block}. Dispatch to act on it.`);
  return { ok: true };
}

function recordDecision(state, e, action) {
  const j = assessment(state, e);
  const validOverride = action === 'dismiss' ? e.truth.people === 0 || !!e.truth.duplicateOf : j.block === e.truth.block && j.severity === e.truth.severity && e.truth.people > 0;
  const d = { time: state.time, event: e.id, condition: e.condition, action, aiCorrect: aiCorrect(e), correctOverride: !e.verified && !aiCorrect(e) && validOverride && state.settings.aggregate, verified: e.verified };
  state.decisions.push(d);
  e.decision = d;
}

export function dismiss(state, eventId) {
  if (!state.started || state.ended) return { ok: false, message: 'There is no active shift.' };
  const e = state.events.find(e => e.id === eventId);
  if (!e || !isOpen(e) || e.scan) return { ok: false, message: 'This report is already assigned or under verification.' };
  recordDecision(state, e, 'dismiss');
  e.dismissed = true;
  e.status = 'dismissed';
  notice(state, 'Report archived. Your assessment will be checked in the debrief.');
  return { ok: true };
}

function duration(state, unit, from, to, path) {
  const congestion = unit.kind === 'air' ? 0 : state.roadIncidents.filter(r => ['active', 'assigned', 'working'].includes(r.status) && r.kind === 'congestion' && path?.some((p, i) => i && edgeKey(path[i - 1], p) === edgeKey(...r.edge))).length * 8;
  return Math.max(5, unit.kind === 'air' ? distance(from, to) * 3.8 : ((path?.length || 2) - 1) * (unit.kind === 'ground' ? 3.2 : 3.8)) + congestion;
}
const waterDuration = path => Math.max(3, ((path?.length || 2) - 1) * 2.6);
function boatPlan(state, unit, destination, shelterId) {
  return launchSites.map(launch => {
    const trailerOut = route(state, unit.position, launch), waterOut = waterRoute(state, launch, destination), trailerBack = route(state, launch, shelterId);
    if (!trailerOut || !waterOut || !trailerBack) return null;
    const outbound = duration(state, unit, unit.position, launch, trailerOut) + 4 + waterDuration(waterOut);
    const returning = waterDuration([...waterOut].reverse()) + 4 + duration(state, unit, launch, shelterId, trailerBack);
    return { launch, trailerOut, waterOut, trailerBack, outbound, return: returning, total: outbound + returning };
  }).filter(Boolean).sort((a, b) => a.total - b.total)[0] || null;
}
function boatSegment(state, unit, mission, stage, from, to, mode) {
  const path = mode === 'water' ? waterRoute(state, from, to) : mode === 'ramp' ? [from, to] : route(state, from, to);
  if (!path) return null;
  const seconds = mode === 'water' ? waterDuration(path) : mode === 'ramp' ? 4 : duration(state, unit, from, to, path);
  return { ...mission, from, to, path, stage, mode, started: state.time, ends: state.time + seconds };
}
function beginBoatTrip(state, unit, destination, event, shelter, patrol = false) {
  const plan = boatPlan(state, unit, destination, shelter); if (!plan) return null;
  const mission = { event, shelter, launch: plan.launch, destination, base: unit.position, patrol };
  return boatSegment(state, unit, mission, 'trailer-out', unit.position, plan.launch, 'trailer');
}
export function estimateTrip(state, unit, destination, shelterId = state.selectedShelter) {
  if (unit.kind === 'drone') return { outbound: 5, return: 5, work: 15, total: 25 };
  if (unit.kind === 'skiff') {
    const plan = boatPlan(state, unit, destination, shelterId);
    return plan ? { outbound: Math.ceil(plan.outbound), return: Math.ceil(plan.return), work: 0, total: Math.ceil(plan.total), launch: plan.launch } : null;
  }
  const out = unit.kind === 'air' ? [unit.position, destination] : route(state, unit.position, destination);
  const back = unit.kind === 'air' ? [destination, shelterId] : route(state, destination, shelterId);
  if (!out || !back) return null;
  const a = Math.ceil(duration(state, unit, unit.position, destination, out)), b = Math.ceil(duration(state, unit, destination, shelterId, back));
  return { outbound: a, return: b, work: 0, total: a + b };
}
function trip(state, unit, from, to, stage, event, shelter) {
  const path = unit.kind === 'air' ? [from, to] : route(state, from, to);
  if (!path) return null;
  return { from, to, path, started: state.time, ends: state.time + duration(state, unit, from, to, path), stage, event, shelter };
}

export function dispatch(state, eventId, unitId, shelterId) {
  if (!state.started || state.ended) return { ok: false, message: 'There is no active shift.' };
  const e = state.events.find(e => e.id === eventId), unit = state.units.find(u => u.id === unitId);
  const shelter = state.shelters.find(s => s.id === shelterId);
  if (!e || !isOpen(e) || e.scan) return { ok: false, message: 'Choose an unassigned report. A scan must finish before dispatch.' };
  if (!unit || unit.status !== 'ready') return { ok: false, message: 'Choose an available rescue unit.' };
  if (!shelter || availableCapacity(shelter) < unit.capacity) return { ok: false, message: `The hub needs ${unit?.capacity || 0} free spaces to reserve this mission. Choose another hub.` };
  const j = assessment(state, e);
  if (unit.kind !== 'air' && unit.kind !== 'skiff' && !route(state, j.block, shelter.id)) return { ok: false, message: 'No open return corridor. Choose another hub or the airlift.' };
  const outgoing = unit.kind === 'skiff' ? beginBoatTrip(state, unit, j.block, e.id, shelterId) : trip(state, unit, unit.position, j.block, 'outbound', e.id, shelterId);
  if (!outgoing) return { ok: false, message: unit.kind === 'skiff' ? 'No flooded waterway is connected to an accessible launch site.' : 'That corridor is closed. Use the airlift or another unit.' };
  recordDecision(state, e, e.correction ? 'override' : e.verified ? 'informed' : state.settings.aggregate ? 'trust' : 'manual');
  shelter.reserved += unit.capacity;
  unit.reservation = unit.capacity;
  unit.trip = outgoing;
  unit.status = 'outbound';
  e.status = 'assigned';
  e.attempts++;
  notice(state, unit.kind === 'skiff' ? `${unit.id} towing to ${outgoing.launch} for launch, then ${j.block}.` : `${unit.id} en route to ${j.block} → ${shelter.name}.`, 'dispatch');
  return { ok: true };
}

export function broadcast(state, blockId, shelterId) {
  if (!state.started || state.ended) return { ok: false, message: 'There is no active shift.' };
  const b = state.blocks.find(b => b.id === blockId), s = state.shelters.find(s => s.id === shelterId);
  if (!b || !s || !b.walkers) return { ok: false, message: 'No unescorted residents remain in this sector.' };
  if (submerged(state, b.id)) return { ok: false, message: 'The water has cut off pedestrian evacuation here.' };
  if (availableCapacity(s) === 0 || !route(state, b.id, s.id)) return { ok: false, message: 'Choose an open hub with reception space.' };
  b.guided = s.id;
  state.broadcasts++;
  feed(state, 'network', `Wayfinding broadcast: ${b.id} → ${s.name}. Walkers now follow the marked corridor.`);
  notice(state, `Evacuation guidance active in ${b.id}. Trapped residents still need rescue.`);
  return { ok: true };
}

export function scout(state, blockId, droneId) {
  if (!state.started || state.ended) return { ok: false, message: 'There is no active shift.' };
  const drone = state.drones.find(d => d.id === droneId);
  if (!drone || drone.status !== 'ready') return { ok: false, message: `${droneId} is already in flight. Select a ready unit.` };
  const reports = state.events.filter(e => e.status !== 'pending' && isOpen(e) && !e.verified && !e.scan && assessment(state, e).block === blockId);
  if (reports.length) return verify(state, reports[0].id, droneId);
  drone.status = 'scanning'; drone.block = blockId; drone.until = state.time + 20;
  drone.trip = { from: 'S2', to: blockId, path: ['S2', blockId], started: state.time, ends: state.time + 5, stage: 'outbound' };
  notice(state, `${droneId} launched. Surveying ${blockId}; return flight follows the scan.`, 'dispatch');
  return { ok: true };
}

export function dispatchArea(state, blockId, unitId, shelterId) {
  const e = state.events.find(e => e.status !== 'pending' && isOpen(e) && !e.scan && assessment(state, e).block === blockId);
  if (e) return dispatch(state, e.id, unitId, shelterId);
  const u = state.units.find(u => u.id === unitId), s = state.shelters.find(s => s.id === shelterId);
  if (!state.started || state.ended || !u || u.status !== 'ready') return { ok: false, message: 'No vehicle of this type is ready.' };
  if (!s || availableCapacity(s) < u.capacity) return { ok: false, message: 'Choose a reception hub with room for a full load.' };
  const t = u.kind === 'skiff' ? beginBoatTrip(state, u, blockId, null, shelterId, true) : trip(state, u, u.position, blockId, 'outbound', null, shelterId);
  if (!t || u.kind !== 'skiff' && !route(state, blockId, shelterId)) return { ok: false, message: u.kind === 'skiff' ? 'The sector is not connected to floodwater or a usable launch site.' : 'No open route to this sector and reception hub.' };
  u.trip = { ...t, patrol: true }; u.status = 'outbound'; u.reservation = u.capacity; s.reserved += u.capacity;
  notice(state, `${u.name} dispatched to search ${blockId}.`, 'dispatch');
  return { ok: true };
}

export function respondRoad(state, roadId, unitId) {
  const r = state.roadIncidents.find(r => r.id === roadId), u = state.units.find(u => u.id === unitId);
  if (!state.started || state.ended || !r || r.status !== 'active') return { ok: false, message: 'This road incident is no longer awaiting a crew.' };
  if (!u || u.kind !== 'ground') return { ok: false, message: 'Select a ground team to clear this road.' };
  if (u.status !== 'ready') return { ok: false, message: `${u.name} is busy. Its return time is shown in the unit bar.` };
  const destinations = r.edge.map(id => ({ id, path: route(state, u.position, id) })).filter(x => x.path).sort((a, b) => a.path.length - b.path.length);
  if (!destinations.length) return { ok: false, message: 'No approach is open to the incident.' };
  const t = trip(state, u, u.position, destinations[0].id, 'outbound', null, null);
  u.trip = { ...t, road: r.id, base: u.position }; u.status = 'outbound'; r.status = 'assigned';
  notice(state, `${u.name} dispatched to ${r.title}.`, 'dispatch');
  return { ok: true };
}

function updateUnits(state) {
  for (const u of state.units) {
    if (u.kind === 'skiff') { updateSkiff(state, u); continue; }
    if (u.trip && u.kind !== 'air' && state.time < u.trip.ends) {
      const t = u.trip;
      const progress = clamp((state.time - t.started) / (t.ends - t.started), 0, .9999);
      const index = Math.floor(progress * (t.path.length - 1));
      // Keep authoritative unit location in sync with the route animation.
      // Ground teams now advance through route nodes instead of appearing to
      // remain at their home until the whole leg finishes.
      u.position = t.path[index] || t.from;
      const ahead = t.path.slice(index);
      if (ahead.some((id, i) => i && state.closedRoads.includes(edgeKey(ahead[i - 1], id)))) {
        const rerouted = trip(state, u, ahead[0], t.to, t.stage, t.event, t.shelter);
        if (rerouted) {
          u.position = ahead[0]; u.trip = { ...t, ...rerouted };
          feed(state, 'network', `${u.id}: corridor closure ahead. Rerouting via ${rerouted.path.join(' → ')}.`, null, false, false, { unitKind: u.kind });
        }
      }
    }
    if (!u.trip || state.time < u.trip.ends) continue;
    if (u.trip.patrol) {
      const t = u.trip;
      const found = t.stage === 'outbound' && state.events.find(e => e.status !== 'pending' && !e.truth.duplicateOf && e.truth.block === t.to && remaining(state, e) && !submerged(state, e.truth.block));
      if (found) { u.trip.event = found.id; delete u.trip.patrol; }
      else if (t.stage === 'outbound') {
        u.position = t.to; u.trip = { ...trip(state, u, t.to, t.shelter, 'return', null, t.shelter), patrol: true }; u.status = 'return';
        notice(state, `${u.name}: no additional residents located in ${t.to}. Returning.`, 'info');
        continue;
      } else {
        const s = state.shelters.find(s => s.id === t.shelter);
        s.reserved -= u.reservation; u.reservation = 0; u.position = t.to; u.trip = null; u.status = 'ready';
        continue;
      }
    }
    if (u.trip.road) {
      const t = u.trip, incident = state.roadIncidents.find(r => r.id === t.road);
      u.position = t.to;
      if (t.stage === 'outbound') {
        incident.status = 'working'; u.status = 'working';
        u.trip = { ...t, from: t.to, path: [t.to, t.to], stage: 'work', started: state.time, ends: state.time + incident.workSeconds };
      } else if (t.stage === 'work') {
        incident.status = 'cleared';
        state.closedRoads = state.closedRoads.filter(key => key !== edgeKey(...incident.edge));
        feed(state, 'network', `${u.name}: ${incident.title} cleared. ${incident.edge.join(' ↔ ')} is open again.`, null, false, false, { unitKind: 'ground' });
        notice(state, `${incident.title} cleared. ${u.name} is returning.`, 'success');
        const back = trip(state, u, t.to, t.base, 'return', null, null);
        u.trip = { ...back, road: incident.id, base: t.base }; u.status = 'return';
      } else { u.trip = null; u.status = 'ready'; }
      continue;
    }
    const t = u.trip, e = state.events.find(e => e.id === t.event), c = canonical(state, e);
    u.position = t.to;
    if (t.stage === 'outbound') {
      const found = t.to === c.truth.block && (u.kind === 'air' || !submerged(state, c.truth.block)) ? Math.min(u.capacity, remaining(state, e)) : 0;
      u.cargo = found;
      c.rescued += found; // Picked up; not counted safe until reaching the hub.
      e.status = found ? (remaining(state, e) ? 'verified' : 'transport') : 'missed';
      if (found) {
        e.verified = true;
        e.correction = null;
        feed(state, 'calls', `${u.id}: ${found} residents aboard at ${t.to}. Returning to reception.`, e.id, false, false, { unitKind: u.kind });
        if (e.decision?.correctOverride && !e.bonusAwarded) { state.bonus += 25; e.bonusAwarded = true; notice(state, 'Context correction confirmed. +25 judgment bonus.', 'success'); }
      } else {
        if (e.truth.people === 0 || e.truth.duplicateOf && !remaining(state, e)) { e.status = 'cleared'; e.verified = true; }
        feed(state, 'calls', `${u.id}: no residents recovered at ${t.to}. ${e.truth.people > 0 && !e.truth.duplicateOf ? 'Recheck the location and waterline.' : 'Dispatch yielded no new rescue.'}`, e.id, false, false, { unitKind: u.kind });
        notice(state, `${u.id} found no one at the assigned location.`, 'warning');
      }
      u.trip = trip(state, u, t.to, t.shelter, 'return', e.id, t.shelter);
      u.status = 'return';
      if (!u.trip) { // A mid-mission closure cannot strand cargo: wait for the air corridor recovery.
        u.trip = { ...t, from: t.to, to: t.shelter, path: [t.to, t.shelter], stage: 'return', started: state.time, ends: state.time + 30 };
        feed(state, 'network', `${u.id}: corridor cut. Emergency transfer adds travel time.`, null, false, false, { unitKind: u.kind });
      }
    } else {
      const s = state.shelters.find(s => s.id === t.shelter);
      s.reserved -= u.reservation;
      s.used += u.cargo;
      state.saved += u.cargo;
      if (u.cargo) notice(state, `${u.cargo} residents received at ${s.name}.`, 'success');
      if (e.status === 'transport') e.status = 'rescued';
      u.cargo = 0;
      u.reservation = 0;
      u.trip = null;
      u.status = 'ready';
    }
  }
}

function updateSkiff(state, u) {
  const t = u.trip; if (!t) return;
  if (t.mode === 'trailer' && state.time < t.ends) {
    const progress = clamp((state.time - t.started) / (t.ends - t.started), 0, .9999), index = Math.floor(progress * (t.path.length - 1)), ahead = t.path.slice(index);
    u.position = t.path[index] || t.from;
    if (ahead.some((id, i) => i && state.closedRoads.includes(edgeKey(ahead[i - 1], id)))) {
      const path = route(state, ahead[0], t.to);
      if (path) {
        u.position = ahead[0]; u.trip = { ...t, from: ahead[0], path, started: state.time, ends: state.time + duration(state, u, ahead[0], t.to, path) };
        feed(state, 'network', `${u.id} trailer: road closure ahead. Rerouting to ${t.to}.`, null, false, false, { unitKind: 'skiff' });
      }
    }
    return;
  }
  if (state.time < t.ends) return;
  u.position = t.to;
  const mission = { event: t.event, shelter: t.shelter, launch: t.launch, destination: t.destination, base: t.base, patrol: t.patrol };
  if (t.stage === 'trailer-out') {
    u.trip = boatSegment(state, u, mission, 'launch', t.launch, t.launch, 'ramp');
    notice(state, `${u.id} reached ${t.launch}. Launching into floodwater.`);
  } else if (t.stage === 'launch') {
    u.trip = boatSegment(state, u, mission, 'water-out', t.launch, t.destination, 'water');
  } else if (t.stage === 'water-out') {
    let e = state.events.find(e => e.id === t.event);
    if (t.patrol && !e) e = state.events.find(e => e.status !== 'pending' && !e.truth.duplicateOf && e.truth.block === t.destination && remaining(state, e) && waterAccessible(state, e.truth.block));
    if (e) {
      u.trip.event = e.id; mission.event = e.id;
      const c = canonical(state, e), found = t.destination === c.truth.block && waterAccessible(state, c.truth.block) ? Math.min(u.capacity, remaining(state, e)) : 0;
      u.cargo = found; c.rescued += found;
      e.status = found ? (remaining(state, e) ? 'verified' : 'transport') : 'missed';
      if (found) {
        e.verified = true; e.correction = null;
        feed(state, 'calls', `${u.id}: ${found} residents aboard from the flooded sector at ${t.destination}. Returning to the launch site.`, e.id, false, false, { unitKind: 'skiff' });
        if (e.decision?.correctOverride && !e.bonusAwarded) { state.bonus += 25; e.bonusAwarded = true; notice(state, 'Context correction confirmed. +25 judgment bonus.', 'success'); }
      } else {
        if (e.truth.people === 0 || e.truth.duplicateOf && !remaining(state, e)) { e.status = 'cleared'; e.verified = true; }
        feed(state, 'calls', `${u.id}: no residents recovered by water at ${t.destination}.`, e.id, false, false, { unitKind: 'skiff' });
      }
    } else notice(state, `${u.name}: no additional residents located by water in ${t.destination}. Returning.`);
    u.trip = boatSegment(state, u, mission, 'water-return', t.destination, t.launch, 'water'); u.status = 'return';
  } else if (t.stage === 'water-return') {
    u.trip = boatSegment(state, u, mission, 'recover', t.launch, t.launch, 'ramp');
    notice(state, `${u.id} recovered at ${t.launch}. Towing to reception.`);
  } else if (t.stage === 'recover') {
    u.trip = boatSegment(state, u, mission, 'trailer-return', t.launch, t.shelter, 'trailer');
  } else {
    const shelter = state.shelters.find(s => s.id === t.shelter), e = state.events.find(e => e.id === t.event);
    shelter.reserved -= u.reservation; shelter.used += u.cargo; state.saved += u.cargo;
    if (u.cargo) notice(state, `${u.cargo} residents received at ${shelter.name}.`, 'success');
    if (e?.status === 'transport') e.status = 'rescued';
    u.cargo = 0; u.reservation = 0; u.trip = null; u.status = 'ready'; u.position = t.shelter;
  }
}

function updateEvacuation(state) {
  for (const convoy of state.convoys.filter(c => !c.done && c.arrives <= state.time)) {
    const s = state.shelters.find(s => s.id === convoy.shelter);
    s.reserved -= convoy.people;
    s.used += convoy.people;
    state.saved += convoy.people;
    convoy.done = true;
  }
  if (state.time - state.evacTick < 8) return;
  state.evacTick = state.time;
  for (const b of state.blocks) {
    if (!b.walkers || submerged(state, b.id)) continue;
    const plan = evacuationPlan(state, b.id, b.guided);
    if (!plan) continue;
    const { shelter: preferred, path } = plan;
    const count = Math.min(b.walkers, b.guided ? 4 : 1, availableCapacity(preferred));
    if (!count) continue;
    preferred.reserved += count;
    b.walkers -= count;
    b.evacuated += count;
    state.convoys.push({ block: b.id, shelter: preferred.id, people: count, path, started: state.time, arrives: state.time + path.length * (b.guided ? 2 : 4), done: false });
  }
}


const CRITICAL_RADIO = [
  ['network', 'TSUNAMI ALERT: impact window under one minute. Keep every viable inland corridor moving.'],
  ['calls', 'Call queue spike: shoreline residents report rapid water rise and abandoned vehicles.'],
  ['sensors', 'Field sensors: water is advancing through low-lying streets faster than earlier readings.'],
  ['network', 'Road desk: pedestrian overflow is building on the main inland routes. Keep rescue lanes clear.'],
  ['calls', 'Multiple partial calls are arriving at once. Expect duplicates, missing details, and panic.'],
  ['sensors', 'Bridge and traffic telemetry are updating unevenly. Treat stale packets with caution.'],
  ['network', 'Reception hubs request final inbound counts. Prioritize unresolved high-risk rescues.'],
  ['calls', 'Emergency traffic increasing: several callers are moving on foot without route guidance.'],
  ['sensors', 'Waterline sensors near the waterfront are dropping offline one after another.'],
  ['network', 'FINAL APPROACH: use only the information you can act on now.'],
  ['calls', 'Last-call traffic: move inland immediately; do not wait for another confirmation.'],
  ['network', 'CASUALTY UPDATE: multiple injuries reported along damaged streets; keep medical access lanes open.'],
  ['calls', 'FAILED EVACUATION ATTEMPT: callers report a blocked route and injured pedestrians near the waterfront.'],
  ['sensors', 'Medical triage demand rising. Several road segments are no longer safe for unassisted movement.'],
  ['network', 'RED STATUS: rescue windows are closing in flooded sectors. Prioritize viable recoveries now.']
];

export function step(state, dt) {
  if (!state.started || state.ended) return;
  // Fixed substeps ensure equal outcomes at 1x, 2x, and in deterministic tests.
  if (dt > 0.25) { for (let left = dt; left > 0 && !state.ended; left -= 0.25) step(state, Math.min(0.25, left)); return; }
  state.time = Math.min(state.level.duration, state.time + dt);
  const phase = phaseAt(state);
  if (phase !== state.lastPhase) {
    state.lastPhase = phase;
    const msg = { BASELINE: 'Link stable. Daylight optical coverage. Read the evidence before committing resources.', 'BLIND SPOTS': 'Nightfall at the ridge. Optical returns are partially occluded. District context matters.', 'LINK DEGRADED': 'Relay outage. Source locations may drift and duplicate reports may arrive. Check original calls.', RECOVERY: 'Relay restored. Fresh location fixes are available. Reassess which tasks need verification.' }[phase];
    feed(state, 'network', msg);
    notice(state, msg, phase === 'LINK DEGRADED' ? 'warning' : 'info');
  }
  for (const system of state.level.systems) if (system.at <= state.time && system.at > state.lastSystem) {
    if (system.close) state.closedRoads.push(edgeKey(...system.close));
    if (system.open) state.closedRoads = state.closedRoads.filter(e => e !== edgeKey(...system.open));
    feed(state, 'network', system.text);
  }
  for (const incident of state.roadIncidents) if (incident.status === 'pending' && state.time >= incident.at) {
    incident.status = 'active';
    if (incident.kind !== 'congestion' && !state.closedRoads.includes(edgeKey(...incident.edge))) state.closedRoads.push(edgeKey(...incident.edge));
    feed(state, 'network', `${incident.title}: ${incident.description}`);
    state.feed[0].roadId = incident.id;
    notice(state, `${incident.title} · ${incident.edge.join(' ↔ ')}`, 'warning');
  }
  for (const line of state.level.colleagues || []) if (line.at <= state.time && line.at > state.lastColleague) state.colleagues.push({ ...line });
  state.lastColleague = state.time;
  state.lastSystem = state.time;
  for (const e of state.events) if (e.status === 'pending' && state.time >= e.at) {
    e.status = 'new';
    feed(state, e.channel, e.raw, e.id);
    feed(state, 'sensors', e.sensor, e.id);
    if (!state.selected) { state.selected = e.id; state.selectedBlock = e.ai.block; }
  }
  const noise = Math.floor(state.time / (state.time >= state.level.duration - 60 ? 4.5 : 13));
  if (noise > state.noiseIndex) {
    state.noiseIndex = noise;
    feed(state, 'calls', state.level.noise[noise % state.level.noise.length], null, true);
  }
  const criticalStart = Math.max(0, state.level.duration - 60);
  if (state.time >= criticalStart) {
    const urgentIndex = Math.floor((state.time - criticalStart) / 3.8);
    if (urgentIndex > state.urgentIndex) {
      for (let i = state.urgentIndex + 1; i <= urgentIndex; i++) {
        const [channel, text] = CRITICAL_RADIO[i % CRITICAL_RADIO.length];
        feed(state, channel, `⚠ ${text}`, null, false, true);
        if (i % 2 === 0) notice(state, text, 'warning');
      }
      state.urgentIndex = urgentIndex;
    }
  }
  for (const d of state.drones) {
    if (d.status === 'return' && state.time >= d.until) { d.status = 'ready'; d.trip = null; d.position = 'S2'; continue; }
    if (d.status !== 'scanning' || state.time < d.until) continue;
    const target = d.trip.to;
    if (d.event) {
    const e = state.events.find(e => e.id === d.event);
    e.verified = true;
    e.scan = 0;
    e.correction = null;
    if (isOpen(e)) e.status = 'verified';
    feed(state, 'sensors', `${d.id} confirmed: ${e.truth.people} residents, ${e.truth.severity} priority, ${e.truth.block}.${e.truth.duplicateOf ? ' Duplicate of ' + e.truth.duplicateOf + '.' : ''} ${e.reveal}`, e.id, false, false, { unitKind: 'drone' });
    notice(state, `Scan complete: ${e.title}. ${aiCorrect(e) ? 'Assessment confirmed.' : 'AI assessment differs from field evidence.'}`, aiCorrect(e) ? 'info' : 'warning');
    d.event = null;
    } else {
      const b = state.blocks.find(b => b.id === d.block);
      feed(state, 'sensors', `${d.id}: survey complete at ${d.block}. ${b.walkers} walking residents remain; ${b.terrain.toLowerCase()} terrain.`, null, false, false, { unitKind: 'drone' });
      notice(state, `${d.id} completed its survey of ${d.block}.`, 'success');
    }
    d.status = 'return'; d.until = state.time + 5;
    d.trip = { from: target, to: 'S2', path: [target, 'S2'], started: state.time, ends: d.until, stage: 'return' };
  }
  updateUnits(state);
  updateEvacuation(state);
  for (const b of state.blocks) if (submerged(state, b.id) && b.walkers) {
    const casualties = b.walkers;
    state.lost += casualties;
    b.lost += casualties;
    b.walkers = 0;
    feed(state, 'network', `⚠ CASUALTY REPORT · ${b.id}: ${casualties} evacuees were overtaken before reaching high ground.`, null, false, true);
    notice(state, `${b.id}: evacuation failure · ${casualties} casualties reported.`, 'warning');
  }
  for (const e of state.events) if (!e.truth.duplicateOf && submerged(state, e.truth.block)) {
    const count = remaining(state, e);
    if (count) {
      e.lost += count;
      state.lost += count;
      if (!['assigned', 'transport'].includes(e.status)) e.status = 'lost';
      feed(state, 'network', `⚠ RESCUE FAILURE · ${e.truth.block}: contact lost as the waterline crosses the sector; ${count} people remain unaccounted for.`, e.id, false, true);
    }
    if (!e.truth.people && isOpen(e) && !e.scan) e.status = 'expired';
  }
  if (state.time >= state.level.duration) finish(state);
}

export function finish(state) {
  if (state.ended) return;
  // Remaining in-flight transports safely reach the high-ground reception hubs.
  for (const u of state.units) if (u.trip) {
    if (u.trip.road) { u.trip = null; u.status = 'ready'; continue; }
    const s = state.shelters.find(s => s.id === u.trip.shelter);
    s.reserved -= u.reservation || 0;
    s.used += u.cargo;
    state.saved += u.cargo;
    u.cargo = 0;
    u.trip = null;
    u.status = 'ready';
  }
  for (const c of state.convoys.filter(c => !c.done)) {
    const s = state.shelters.find(s => s.id === c.shelter);
    s.reserved -= c.people;
    s.used += c.people;
    state.saved += c.people;
    c.done = true;
  }
  for (const e of state.events) if (!e.truth.duplicateOf) { const n = remaining(state, e); e.lost += n; state.lost += n; }
  for (const b of state.blocks) { state.lost += b.walkers; b.lost += b.walkers; b.walkers = 0; }
  for (const e of state.events) if (e.decision?.correctOverride && !e.bonusAwarded && e.decision.action === 'dismiss') { state.bonus += 25; e.bonusAwarded = true; }
  state.ended = true;
}

export function debrief(state) {
  const decisions = state.decisions;
  const trust = decisions.filter(d => d.action === 'trust');
  const scans = decisions.filter(d => d.action === 'verify');
  const groups = ['Clear / routine', 'Dark / occluded', 'Device proxy', 'Relay degraded', 'Restored / routine'].map(condition => {
    const reports = state.events.filter(e => e.condition === condition);
    const choices = decisions.filter(d => d.condition === condition && ['trust', 'verify', 'override', 'dismiss', 'informed', 'manual'].includes(d.action));
    const acted = new Set(choices.map(d => d.event));
    const trusted = new Set(choices.filter(d => d.action === 'trust').map(d => d.event));
    return { condition, total: reports.length, correct: reports.filter(aiCorrect).length, acted: acted.size, trusted: trusted.size };
  });
  return {
    population: totalPopulation(state), score: state.saved * 10 + state.bonus,
    efficient: trust.filter(d => d.aiCorrect).length, misled: trust.filter(d => !d.aiCorrect).length,
    caught: scans.filter(d => !d.aiCorrect).length, confirmed: scans.filter(d => d.aiCorrect).length,
    corrections: state.events.filter(e => e.bonusAwarded).length,
    groups, decisions,
  };
}
