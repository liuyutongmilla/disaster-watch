export class Soundscape {
  constructor() { this.enabled = false; this.paused = false; this.context = null; this.lastPulse = 0; this.lastFeed = 0; this.siren = null; }
  async unlock() {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return false;
      if (!this.context) {
        this.context = new Audio();
        this.master = this.context.createGain(); this.master.gain.value = 0; this.master.connect(this.context.destination);
        // A quiet three-tone pad under the event cues. All sound is synthesized locally.
        for (const freq of [55, 82.41, 110]) {
          const osc = this.context.createOscillator(), gain = this.context.createGain();
          osc.type = 'sine'; osc.frequency.value = freq; gain.gain.value = .022;
          osc.connect(gain); gain.connect(this.master); osc.start();
        }
      }
      await this.context.resume();
      return true;
    } catch { return false; }
  }
  async toggle() {
    if (!await this.unlock()) return false;
    this.enabled = !this.enabled;
    this.master.gain.setTargetAtTime(this.enabled ? .55 : 0, this.context.currentTime, .1);
    return this.enabled;
  }
  async enable() {
    if (!await this.unlock()) return false;
    this.enabled = true;
    this.master.gain.setTargetAtTime(.55, this.context.currentTime, .1);
    return true;
  }
  setPaused(paused) {
    this.paused = paused;
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.enabled && !paused ? .55 : 0, this.context.currentTime, .08);
  }
  setCritical(active) {
    if (!active) {
      if (!this.siren) return;
      const { carrier, lfo, depth, gain } = this.siren;
      const t = this.context.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0, t, .08);
      carrier.stop(t + .35); lfo.stop(t + .35);
      carrier.onended = () => { carrier.disconnect(); lfo.disconnect(); depth.disconnect(); gain.disconnect(); };
      this.siren = null;
      return;
    }
    if (!this.context || this.siren) return;
    const t = this.context.currentTime;
    const carrier = this.context.createOscillator(), lfo = this.context.createOscillator();
    const depth = this.context.createGain(), gain = this.context.createGain();
    carrier.type = 'sawtooth'; carrier.frequency.value = 720;
    lfo.type = 'sine'; lfo.frequency.value = .48; depth.gain.value = 210;
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(.075, t + .3);
    lfo.connect(depth); depth.connect(carrier.frequency); carrier.connect(gain); gain.connect(this.master);
    carrier.start(t); lfo.start(t); this.siren = { carrier, lfo, depth, gain };
  }
  cue(channel = 'sensors') {
    if (!this.context || !this.enabled || this.paused) return;
    const t = this.context.currentTime, osc = this.context.createOscillator(), gain = this.context.createGain();
    const hz = { calls: 520, sensors: 880, network: 190, success: 660, dispatch: 390 }[channel] || 420;
    osc.type = channel === 'calls' ? 'triangle' : 'sine'; osc.frequency.setValueAtTime(hz, t); osc.frequency.exponentialRampToValueAtTime(hz * .74, t + .16);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(.1, t + .01); gain.gain.exponentialRampToValueAtTime(.001, t + .24);
    osc.connect(gain); gain.connect(this.master); osc.start(); osc.stop(t + .25);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  update(state) {
    if (!this.context || !this.enabled) return;
    this.master.gain.setTargetAtTime(state.ended || !state.started ? 0 : .55, this.context.currentTime, .15);
    const visible = state.feed.filter(f => !f.noise || !state.settings.filter);
    if (visible[0]?.id !== this.lastFeed) { this.lastFeed = visible[0]?.id; this.cue(visible[0]?.channel); }
    const load = state.events.filter(e => ['new', 'verified', 'missed'].includes(e.status)).length;
    const interval = load >= 6 ? 1.1 : load >= 3 ? 2.4 : 5;
    if (!state.ended && state.time - this.lastPulse > interval) { this.lastPulse = state.time; this.cue('network'); }
  }
}

export class ColleagueVoice {
  constructor(element) { this.element = element; this.queue = []; this.active = false; this.generation = 0; }
  say(line, audible) {
    this.queue.push({ line, audible });
    if (this.queue.length > 3) this.queue.shift();
    if (!this.active) this.next();
  }
  next() {
    const item = this.queue.shift(); if (!item) { this.active = false; return; }
    this.active = true;
    const { line, audible } = item, token = ++this.generation;
    const bubble = this.element;
    bubble.replaceChildren(); bubble.hidden = false; bubble.classList.remove('fading');
    const avatar = document.createElement('span'); avatar.className = 'colleague-avatar'; avatar.textContent = line.name[0];
    const content = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = line.name;
    const role = document.createElement('small'); role.textContent = line.role;
    const text = document.createElement('p'); text.textContent = line.text;
    content.append(title,role,text); bubble.append(avatar,content);
    const readingTime = Math.max(4500, Math.min(14000, line.text.length * 55));
    const finish = () => {
      if (token !== this.generation) return;
      clearTimeout(this.timer); bubble.classList.add('fading');
      this.timer = setTimeout(() => { if (token !== this.generation) return; bubble.hidden = true; this.active = false; this.next(); }, 650);
    };
    this.timer = setTimeout(finish, readingTime);
    if (audible && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
      const utterance = new SpeechSynthesisUtterance(line.text);
      utterance.lang = 'en-US'; utterance.rate = .98;
      const voices = speechSynthesis.getVoices();
      utterance.voice = voices.find(v => /^en[-_]US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
      utterance.onstart = () => { if (token !== this.generation) return; clearTimeout(this.timer); this.timer = setTimeout(finish, 25000); };
      utterance.onend = finish;
      utterance.onerror = () => { if (token !== this.generation) return; clearTimeout(this.timer); this.timer = setTimeout(finish, readingTime); };
      this.utterance = utterance;
      try { speechSynthesis.speak(utterance); } catch { /* The same bubble remains readable if the OS has no voice. */ }
    }
  }
  stopSpeech() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  cancel() { this.generation++; this.queue = []; this.active = false; clearTimeout(this.timer); this.stopSpeech(); this.element.hidden = true; }
}
