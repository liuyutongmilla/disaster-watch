import { createState, start, step, correct, dismiss, dispatch, dispatchArea, scout, verify, respondRoad, broadcast, assessment, isOpen, linkDown, availableCapacity, estimateTrip, debrief, notice, radioMessageRelevant } from './engine.js';
import { OperatingMap } from './map.js';
import { Soundscape, ColleagueVoice } from './audio.js';
import { showDebrief } from './review.js';
const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types = {
  ground: { name: 'Ground team', capacity: '(8 people / vehicle)', icon: '<path d="M3 7h11v10H3zM14 10h4l3 4v3h-7M6 7V4h5v3"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>' },
  skiff: { name: 'Rescue boat', capacity: '(16 people / boat)', icon: '<path d="m3 13 3 6h12l3-6H3ZM8 13V7h8v6M12 7V3M3 22q3-3 6 0t6 0t6 0"/>' },
  air: { name: 'Helicopter', capacity: '(12 people / aircraft)', icon: '<path d="M3 4h18M12 4v5M5 19h14M9 14v5m7-5v5M8 9h8l3 5H7a2.5 2.5 0 0 1 1-5ZM7 12H3V8"/>' },
  drone: { name: 'Recon drone', capacity: 'Recon only', icon: '<path d="m7 7 10 10M7 17 17 7"/><circle cx="6" cy="6" r="4"/><circle cx="18" cy="6" r="4"/><circle cx="6" cy="18" r="4"/><circle cx="18" cy="18" r="4"/><rect x="9" y="9" width="6" height="6" rx="2"/>' }
};
const expandedSources = new Set();
const sound = new Soundscape();
const voice = new ColleagueVoice($('colleague'));
const RADIO_DELAY = 5;
const CRITICAL_WINDOW = 60;
let state, level, tab = 'all', endedShown = false, editing = false, paused = false, lastFrame = performance.now(), lastRender = 0, seenColleague = 0, seenUrgentVoiceId = 0, feedbackTimer, drag = null;
let selectedMessageId = null, mapSelectionActive = false, chatSignature = '';
const map = new OperatingMap($('map'), hit => {
  if (!state?.started || state.ended || paused || drag) return;
  selectHit(hit);
});
function setPaused(value) {
  if (!state?.started || state.ended || paused === value) return;
  paused = value; drag = null; $('drag-ghost')?.remove(); map.dropHover = null;
  $('pause-screen').hidden = !paused; $('pause').setAttribute('aria-pressed', String(paused)); $('pause').title = paused ? 'Resume game' : 'Pause game';
  document.body.classList.toggle('game-paused', paused); sound.setPaused(paused);
  if (paused) voice.cancel();
  lastFrame = performance.now();
  if (paused) $('resume').focus(); else $('pause').focus();
}
function units(kind = state.selectedKind) { return kind === 'drone' ? state.drones : state.units.filter(u => u.kind === kind); }
function selectedUnit() { return units().find(u => u.status === 'ready') || units()[0]; }
function currentEvent() { return state.events.find(e => e.id === state.selected); }
function selectHit(hit) {
  if (!hit) return;
  editing = false; state.selectedRoad = null;
  if (hit.kind === 'shelter') { state.selectedShelter = hit.id; render(true); return; }
  if (hit.kind === 'road') {
    state.selectedRoad = hit.id; state.selected = null; mapSelectionActive = false;
    state.selectedBlock = state.roadIncidents.find(r => r.id === hit.id).edge[0];
  } else if (hit.kind === 'event') {
    state.selected = hit.id; state.selectedBlock = assessment(state, currentEvent()).block; mapSelectionActive = false;
  } else {
    state.selectedBlock = hit.id; mapSelectionActive = true; selectedMessageId = null;
    const current = currentEvent();
    if (!current || assessment(state, current).block !== hit.id || !isOpen(current)) state.selected = state.events.find(e => e.status !== 'pending' && isOpen(e) && assessment(state, e).block === hit.id)?.id || null;
  }
  render(true);
}
function feedback(text, error = false) {
  $('feedback').hidden = false; $('feedback').textContent = text; $('feedback').classList.toggle('error-feedback', error);
  clearTimeout(feedbackTimer); feedbackTimer = setTimeout(() => { $('feedback').hidden = true; }, 5500);
}
function act(result) {
  feedback(result.ok ? state.notices.at(-1)?.text || 'Order received.' : result.message, !result.ok);
  if (result.ok) sound.cue('dispatch');
  render(true);
}
function send() {
  if (!state?.started || state.ended) return;
  const u = selectedUnit(), e = currentEvent();
  if (!u || u.status !== 'ready') { feedback(`All ${types[state.selectedKind].name.toLowerCase()} units are busy. Their return progress is shown below.`, true); return; }
  if (u.kind === 'drone') {
    act(e && isOpen(e) && !e.verified ? verify(state, e.id, u.id) : scout(state, state.selectedBlock, u.id)); return;
  }
  if (state.selectedRoad) { act(respondRoad(state, state.selectedRoad, u.id)); return; }
  act(e ? dispatch(state, e.id, u.id, state.selectedShelter) : dispatchArea(state, state.selectedBlock, u.id, state.selectedShelter));
}
function reset(begin = false) {
  paused = false; sound.setPaused(false); sound.setCritical(false); document.body.classList.remove('game-paused','final-minute'); $('pause-screen').hidden = true; $('pause').setAttribute('aria-pressed', 'false'); $('pause').title = 'Pause game';
  state = createState(level); tab = 'all'; endedShown = false; editing = false; seenColleague = 0; seenUrgentVoiceId = 0;
  selectedMessageId = null; mapSelectionActive = false; chatSignature = '';
  expandedSources.clear(); sound.lastFeed = 0; sound.lastPulse = 0; voice.cancel();
  $('report-list').replaceChildren(); $('intro').hidden = begin; $('debrief').hidden = true; $('feedback').hidden = true; $('critical-alert').hidden = true; $('speed').textContent = '1×';
  $('sound').classList.toggle('sound-on', sound.enabled); $('sound').setAttribute('aria-pressed', String(sound.enabled)); $('sound').title = sound.enabled ? 'Mute sound' : 'Enable sound';
  $('sector-select').innerHTML = level.blocks.map(b => `<option value="${b.id}">${b.id} · ${b.name.toLowerCase()}</option>`).join('');
  $('shelter-select').innerHTML = state.shelters.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  $('fleet').innerHTML = Object.entries(types).map(([kind,t]) => `<button class="type-card" data-kind="${kind}" aria-label="${t.name}. Drag to the map to dispatch." aria-pressed="false"><span class="vehicle-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${t.icon}</svg></span><span class="type-copy"><strong>${t.name}<b class="available-count"></b></strong><small>${t.capacity}</small><span class="unit-progress"></span></span></button>`).join('');
  if (begin) { start(state); lastFrame = performance.now(); }
  render(true);
}
function actionPanel(event = null, road = null) {
  const unit = selectedUnit();
  const estimate = unit ? estimateTrip(state, unit, state.selectedBlock) : null;
  const unitLabel = `${types[state.selectedKind].name}${unit?.capacity ? ` (${unit.capacity} seats)` : ''}`;
  const launchName = estimate?.launch ? state.blocks.find(b => b.id === estimate.launch)?.name.toLowerCase() : '';
  const timing = estimate ? `${estimate.outbound}s out${estimate.work ? ` · ${estimate.work}s scan` : ''} · ${estimate.return}s back${launchName ? ` · launch: ${launchName}` : ''}` : state.selectedKind === 'skiff' ? 'No flood-connected launch' : 'No open route';
  const hubOptions = state.shelters.map(s => `<option value="${s.id}" ${s.id === state.selectedShelter ? 'selected' : ''}>${esc(s.name)} · ${availableCapacity(s)} free</option>`).join('');
  const correction = event && editing ? `<div class="inline-correction"><select id="correct-block" aria-label="Correct sector">${state.blocks.map(b => `<option value="${b.id}" ${b.id === state.selectedBlock ? 'selected' : ''}>${b.id} · ${esc(b.name.toLowerCase())}</option>`).join('')}</select><select id="correct-priority" aria-label="Correct priority"><option value="high" ${assessment(state,event).severity === 'high' ? 'selected' : ''}>High priority</option><option value="low" ${assessment(state,event).severity === 'low' ? 'selected' : ''}>Low priority</option></select><button id="apply-correction">Apply</button></div>` : '';
  return `<div class="report-actions" role="group" aria-label="Available actions">
    <div class="action-summary"><strong>${esc(unitLabel)}</strong><span>${esc(timing)}</span></div>
    ${state.selectedKind === 'drone' || road ? '' : `<select class="report-hub" data-action-hub aria-label="Reception hub">${hubOptions}</select>`}
    ${correction}
    <div class="action-buttons">
      <button id="dispatch" class="send-button">${state.selectedKind === 'drone' ? 'Send drone' : road ? 'Clear road' : 'Send rescue'} <span>→</span></button>
      ${event && isOpen(event) && !event.verified ? '<button data-action="verify">Verify</button>' : ''}
      ${event && isOpen(event) ? `<button data-action="edit">${editing ? 'Cancel edit' : 'Edit'}</button><button data-action="archive">Archive</button>` : ''}
    </div>
  </div>`;
}
function renderChat() {
  const list = $('report-list'), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 65;
  const radioDelay = state.time >= state.level.duration - CRITICAL_WINDOW ? 1.2 : RADIO_DELAY;
  const messages = state.feed.filter(f => state.time >= f.time + radioDelay
    && (!state.settings.filter || radioMessageRelevant(state, f, state.selectedKind))
    && (tab === 'all' || f.channel === tab)).slice(0,80).reverse();
  const road = state.roadIncidents.find(r => r.id === state.selectedRoad);
  const event = currentEvent();
  const signature = JSON.stringify([messages.map(f => f.id), tab, state.selected, state.selectedRoad, selectedMessageId, mapSelectionActive, editing, state.selectedKind, state.selectedShelter, state.settings, state.units.map(u => u.status), state.drones.filter(d => d.status === 'ready').length, event?.status, event?.verified, event?.scan, expandedSources.has(event?.id)]);
  if (signature === chatSignature) return;
  chatSignature = signature;
  const oldHeight = list.scrollHeight, oldTop = list.scrollTop;
  if (!messages.length && !mapSelectionActive) {
    list.innerHTML = '<div class="radio-empty"><span></span><strong>Radio clear</strong><small>Waiting for incoming traffic…</small></div>';
  } else {
    list.innerHTML = messages.map(f => {
      const e = state.events.find(e => e.id === f.eventId);
      const selected = !!e && e.id === state.selected || !!f.roadId && f.roadId === state.selectedRoad;
      const expanded = selected && (selectedMessageId ? String(f.id) === String(selectedMessageId) : e ? f.text === e.raw : !!f.roadId);
      const who = f.urgent ? '⚠ EMERGENCY ALERT' : f.noise ? 'Station chat' : f.roadId ? 'Road patrol' : f.channel === 'calls' ? 'Incoming call' : f.channel === 'sensors' ? 'Field sensor' : 'Dispatch radio';
      const text = e && f.channel === 'calls' && state.settings.calls && f.text === e.raw && !expandedSources.has(e.id) ? e.ai.summary : f.text;
      const status = e ? e.scan ? 'Drone scanning' : e.status === 'assigned' ? 'Rescue on the way' : e.status === 'transport' ? 'Returning with residents' : e.status === 'rescued' ? 'Received at shelter' : e.verified ? 'Field checked' : e.status === 'dismissed' ? 'Archived' : e.status === 'lost' ? 'Contact lost' : 'Open report' : f.roadId ? 'Road incident' : '';
      const details = expanded && e ? `<div class="report-details"><h3>${esc(e.title)}</h3><div><span>${assessment(state,e).block}</span><span>${assessment(state,e).people} ${e.verified ? 'confirmed' : 'reported'}</span><span>${assessment(state,e).severity} priority</span></div><p>${esc(e.sensor)}</p></div>${actionPanel(e)}` : expanded && f.roadId ? `<div class="report-details"><h3>${esc(road.title)}</h3><p>${esc(road.description)}</p></div>${actionPanel(null,road)}` : '';
      return `<div class="chat-row ${f.channel} ${f.noise ? 'noise' : ''} ${f.urgent ? 'urgent' : ''} ${selected ? 'selected' : ''} ${expanded ? 'expanded' : ''}" data-id="${f.id}"><span class="avatar">${f.noise ? 'S' : f.channel === 'calls' ? 'C' : f.channel === 'sensors' ? 'F' : 'R'}</span><div class="message-wrap"><span class="sender">${who}${e ? ` <small>${e.id}</small>` : ''}</span><button class="chat-bubble" ${f.eventId ? `data-event="${f.eventId}"` : ''} ${f.roadId ? `data-road="${f.roadId}"` : ''}><p>${esc(text)}</p>${e && state.settings.aggregate && f.text === e.raw ? `<div class="ai-note">Assistant · ${e.ai.confidence}% confidence<br>${esc(e.ai.reason)}</div>` : ''}${status ? `<span class="message-state">${status}${expanded ? ' ↑' : ' →'}</span>` : ''}</button>${e && state.settings.calls && f.text === e.raw ? `<button class="source-toggle" data-original="${e.id}">${expandedSources.has(e.id) ? 'Show summary' : 'Read original call'}</button>` : ''}${details}</div></div>`;
    }).join('') + (mapSelectionActive ? `<div class="map-selection"><span>Selected area</span><strong>${esc(state.blocks.find(b => b.id === state.selectedBlock).name)}</strong><small>${state.selectedBlock} · choose an action</small>${actionPanel()}</div>` : '');
  }
  if (atBottom) list.scrollTop = list.scrollHeight;
  else list.scrollTop = Math.max(0, oldTop + list.scrollHeight - oldHeight);
  $('new-messages').hidden = atBottom;
  const visibleOpen = state.events.filter(e => isOpen(e) && state.time >= e.at + radioDelay
    && (!state.settings.filter || radioMessageRelevant(state, { eventId: e.id }, state.selectedKind))).length;
  $('pending').textContent = visibleOpen ? `${visibleOpen} open` : 'clear';
}
function render(force = false) {
  if (!state) return;
  const remaining = Math.max(0, state.level.duration - state.time);
  const critical = state.started && !state.ended && remaining <= CRITICAL_WINDOW;
  document.body.classList.toggle('final-minute', critical);
  sound.setCritical(critical);
  $('critical-alert').hidden = !critical;
  if (critical) $('critical-countdown').textContent = 'CRITICAL IMPACT PHASE';
  $('wifi').classList.toggle('offline', linkDown(state)); $('wifi').title = linkDown(state) ? 'Relay degraded' : 'Relay connected'; $('wifi').setAttribute('aria-label', $('wifi').title);
  document.querySelectorAll('[data-setting]').forEach(b => { const on = state.settings[b.dataset.setting]; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  document.querySelectorAll('[data-tab]').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
  const on = Object.values(state.settings).filter(Boolean).length; $('assistant-status').textContent = on ? `${on} enabled` : 'All off';
  for (const button of $('fleet').children) {
    const pool = units(button.dataset.kind), ready = pool.filter(u => u.status === 'ready').length, busy = pool.filter(u => u.status !== 'ready');
    button.classList.toggle('selected', button.dataset.kind === state.selectedKind); button.setAttribute('aria-pressed', String(button.dataset.kind === state.selectedKind));
    button.querySelector('.available-count').textContent = `×${ready}`;
    button.querySelector('.unit-progress').textContent = busy.length ? `${busy.length} out · ${busy.filter(u => u.status === 'return').length} returning${busy.some(u=>u.status==='return') ? ' ('+Math.max(0,Math.ceil(Math.min(...busy.filter(u=>u.status==='return').map(u=>u.trip?.ends||u.until))-state.time))+'s)' : ''}` : 'Drag onto the map';
    button.title = busy.map(u => `${u.id}: ${u.status}, ${Math.max(0, Math.ceil((u.trip?.ends || u.until) - state.time))}s in this leg${u.cargo ? `, ${u.cargo} aboard` : ''}`).join('\n') || 'All units ready';
  }
  const b = state.blocks.find(b => b.id === state.selectedBlock);
  if (document.activeElement !== $('sector-select')) $('sector-select').value = state.selectedBlock;
  if (document.activeElement !== $('shelter-select')) $('shelter-select').value = state.selectedShelter;
  for (const option of $('shelter-select').options) { const s = state.shelters.find(s => s.id === option.value); option.textContent = `${s.name} · ${availableCapacity(s)} free`; }
  $('broadcast').disabled = !state.started || state.ended;
  renderChat();
  if (!paused) for (; seenColleague < state.colleagues.length; seenColleague++) { const line = state.colleagues[seenColleague]; if (!line.noise || !state.settings.filter) voice.say(line, sound.enabled); }
  if (critical && !paused) {
    const urgentFeed = state.feed.filter(f => f.urgent && f.id > seenUrgentVoiceId).sort((a,b)=>a.id-b.id);
    for (const item of urgentFeed) {
      voice.say({ name: 'Emergency Dispatch', role: 'Priority channel', text: item.text.replace(/^⚠\s*/, '') }, sound.enabled);
      seenUrgentVoiceId = item.id;
    }
  }
  if (state.ended && !endedShown) { endedShown = true; voice.cancel(); showDebrief(state, level); }
}
// The unit buttons and dispatch controls stay mounted during pointer gestures.
document.addEventListener('pointerdown', event => {
  const button = event.target.closest('[data-kind]');
  if (!button || !state?.started || state.ended || paused) return;
  state.selectedKind = button.dataset.kind; render();
  drag = { button, startX:event.clientX, startY:event.clientY, moved:false, pointer:event.pointerId };
  button.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove', event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  if (Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>7) drag.moved=true;
  if (!drag.moved) return;
  event.preventDefault();
  let ghost = $('drag-ghost');
  if (!ghost) { ghost=document.createElement('div');ghost.id='drag-ghost';ghost.textContent=types[state.selectedKind].name;document.body.append(ghost); }
  ghost.style.left=`${event.clientX+12}px`;ghost.style.top=`${event.clientY-24}px`;
  map.dropHover = map.hitAt(event.clientX,event.clientY);
});
document.addEventListener('pointerup', event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  const moved=drag.moved, hit=map.hitAt(event.clientX,event.clientY);
  drag=null; $('drag-ghost')?.remove();map.dropHover=null;
  if (moved) { if(hit && hit.kind!=='shelter'){ selectHit(hit);send(); } else feedback('Drop the unit on a street, report, or road incident.',true); }
});
document.addEventListener('pointercancel',()=>{drag=null;$('drag-ghost')?.remove();map.dropHover=null;});
document.addEventListener('click', async event => {
  const button=event.target.closest('button'); if(!button)return;
  if(button.id==='resume'){setPaused(false);return;}
  if(button.id==='pause'){setPaused(!paused);return;}
  if(paused)return;
  if(button.id==='sound'){ await sound.toggle(); if(!sound.enabled)voice.stopSpeech(); button.classList.toggle('sound-on',sound.enabled); button.setAttribute('aria-pressed',String(sound.enabled)); button.title=sound.enabled?'Mute sound':'Enable sound';return; }
  if(button.id==='help'){ $('guide').showModal();return; }
  if(button.id==='close-guide'){ $('guide').close();return; }
  if(!state)return;
  if(button.id==='begin'||button.id==='replay'){ await sound.enable();reset(true);return; }
  if(button.id==='restart-link'){reset(false);return;}
  if(button.id==='export'&&state.ended){const content={...debrief(state),saved:state.saved,lost:state.lost,reports:state.events.map(e=>({id:e.id,ai:e.ai,truth:e.truth,rescued:e.rescued,lost:e.lost}))};const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='disaster-watch-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
  if(state.ended)return;
  if(button.dataset.kind){state.selectedKind=button.dataset.kind;render();return;}
  if(button.dataset.original){const id=button.dataset.original;expandedSources.has(id)?expandedSources.delete(id):expandedSources.add(id);render();return;}
  if(button.dataset.action==='verify'){state.selectedKind='drone';send();return;}
  if(button.dataset.action==='edit'){editing=!editing;chatSignature='';render(true);return;}
  if(button.dataset.action==='archive'){act(dismiss(state,state.selected));return;}
  if(button.dataset.event){selectedMessageId=button.closest('.chat-row')?.dataset.id||null;selectHit({kind:'event',id:button.dataset.event});return;}
  if(button.dataset.road){selectedMessageId=button.closest('.chat-row')?.dataset.id||null;selectHit({kind:'road',id:button.dataset.road});return;}
  if(button.dataset.tab){tab=button.dataset.tab;render();return;}
  if(button.dataset.setting){const key=button.dataset.setting;state.settings[key]=!state.settings[key];render(true);return;}
  if(button.id==='new-messages'){$('report-list').scrollTop=$('report-list').scrollHeight;button.hidden=true;return;}
  if(button.id==='speed'){state.speed=state.speed===1?2:1;button.textContent=`${state.speed}×`;return;}
  if(button.id==='dispatch'){send();return;}
  if(button.id==='broadcast'){act(broadcast(state,state.selectedBlock,state.selectedShelter));return;}
  if(button.id==='apply-correction'){const patch={block:$('correct-block').value,severity:$('correct-priority').value};editing=false;state.selectedBlock=patch.block;act(correct(state,state.selected,patch));return;}
});
document.addEventListener('change',event=>{if(!state||paused)return;if(event.target.id==='sector-select')selectHit({kind:'block',id:event.target.value});if(event.target.id==='shelter-select'||event.target.matches('[data-action-hub]')){state.selectedShelter=event.target.value;chatSignature='';render();}});
document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey)return;if(e.key==='Escape'&&state?.started&&!state.ended&&!$('guide').open){e.preventDefault();setPaused(!paused);return;}if(paused||e.target.matches('input,select,textarea'))return;if(e.key.toLowerCase()==='m')$('sound').click();});
function frame(now){const dt=(now-lastFrame)/1000;lastFrame=now;if(state){if(!paused)step(state,Math.max(0,dt)*state.speed);map.draw(state,now);if(!paused&&now-lastRender>180){render();if(state.time>=RADIO_DELAY)sound.update(state);lastRender=now;}}requestAnimationFrame(frame);}
try{const response=await fetch('./data/level.json');if(!response.ok)throw Error(`HTTP ${response.status}`);level=await response.json();reset();$('begin').disabled=false;$('begin').innerHTML='Begin shift <span>→</span>';}catch(e){$('load-error').hidden=false;$('load-error').textContent=`Run npm start and reload. ${e.message}`;}
requestAnimationFrame(frame);
