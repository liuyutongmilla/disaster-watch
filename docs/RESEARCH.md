# Evidence and simulation boundaries

Checked 19 September 2026. The prototype is a fictional rescue-command game. Its numerical rules are authored teaching scenarios, not estimates of real rescue performance.

## Human–AI trust

- [Okamura & Yamada (2020), Adaptive trust calibration for human-AI collaboration](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0229132): a drone-inspection simulator study with 116 participants and weather-dependent reliability found that adaptive cues could improve calibration during over-trust. This supports making changing operating conditions visible. It does not establish that this game trains transferable skills or that any particular accuracy percentage is realistic.
- [Dietvorst, Simmons & Massey (2015), Algorithm aversion](https://faculty.wharton.upenn.edu/wp-content/uploads/2016/11/20-Dietvorst-Simmons-Massey-2015.pdf): across five studies, seeing algorithm errors could reduce people's willingness to use algorithmic forecasts, including when those forecasts performed better than human alternatives. The restored-link phase is inspired by this failure mode, not a replication of the experiments.
- Reviewing a correct AI judgment is not necessarily irrational. The debrief calls it a "confirmation" and records the time cost; it does not assume that every confirmation was an objectively bad choice. The hidden truth is used retrospectively to describe results, never as advance advice.

## Sensors and population proxies

- [NASA ARSET, Radar remote sensing for flood monitoring](https://disasters.nasa.gov/get-involved/training/english/ask-nasa-arset-radar-remote-sensing-flood-monitoring): SAR can observe day or night and in nearly all weather. Optical classification limitations must not be attributed to all sensors. Our darkness/occlusion examples concern optical image classification.
- [ESA, Sentinel-1 facts and figures](https://www.esa.int/Applications/Observing_the_Earth/Copernicus/Sentinel-1/Facts_and_figures): six days at the equator describes a two-satellite configuration. It is not a universal refresh rate for satellite products. The game's old survey outline is explicitly an old snapshot; its age and the live waterline are fictional.
- [GSMA, State of Mobile Internet Connectivity 2020](https://www.gsma.com/somic/wp-content/uploads/2025/08/State_of_Mobile_Internet_Connectivity_2020.pdf): connections and unique subscribers differ; one subscriber can have multiple connections. [GSMA connectivity overview](https://www.gsma.com/somic/) also distinguishes network availability from actual use. These support the general warning that device counts are not headcounts. Exact district multipliers, empty offices, and low-signal care homes in the game are scripted examples, not universal demographic rules. A care-home counterexample is included.

## Browser behavior

- [MDN, Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices): create or resume audio inside a user gesture. The Begin shift and sound buttons do this, with a silent fallback if audio is unavailable.

## Flood-rescue boat deployment

- [FEMA Swiftwater/Flood Search and Rescue Team](https://rtlt.preptoolkit.fema.gov/Public/Resource/ViewFile/8-508-1020?q=swiftwater&s=FemaId&type=Pdf) includes ground vehicles and trailers capable of hauling personnel, equipment, and boats. This supports showing the prototype's skiffs on tow vehicles before launch instead of depicting them travelling independently on dry roads.
- [FEMA Boat Bowman qualification](https://rtlt.preptoolkit.fema.gov/Public/Position/ViewFile/8-509-1186?q=water+rescue&type=Pdf) includes identifying safe launch and recovery sites, trailering, shallow-water hazards, and powered or paddle-craft operation in floodwater. The game therefore separates road transport, ramp work, and water travel.
- Exact travel times, the two fixed launch ramps, and the rule that adjacent flooded sectors form a navigable waterway remain authored abstractions. They do not model current, debris, contamination, draft, crew safety, or a real incident action plan.

## Deliberate abstractions

The six-minute mission, two twenty-second verification drones, flood progression, skiff travel, airlift capacity, reception capacities, scripted transmission errors, exact truth obtained by verification, and scoring are game rules. The scenario contains no live LLM, real-time sensor connection, real emergency advice, or claim that an actual AI intrinsically lacks contextual reasoning. A scripted assistant misses specific contextual clues to make its failure modes inspectable. Raw source evidence can also be incomplete.

The source design's blanket claim about personal-device prohibitions in all command centers is not used. No claim about the actual jam tracks or rules is independently made. All visuals and synthetic sounds are created in code; no external fonts, audio, or art licenses are required.

## v0.2 visual reference and speech

- The [official Mini Motorways store screenshots](https://store.steampowered.com/app/1127500/Mini_Motorways/) were opened and a full-size official screenshot was inspected during the v0.2 revision. The resulting original Canvas drawing uses off-white land, blue water, white roadways, flat colored buildings, and consistent directional shadows. No reference artwork is shipped as a game asset.
- [MDN: SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis) documents browser speech and available voices; [voiceschanged](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/voiceschanged_event) documents asynchronously changing voice availability. [SpeechSynthesisUtterance end](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/end_event) is used to fade dialogue after speech finishes. The implementation selects a currently available English voice when possible and otherwise requests `en-US` from the browser. Voice availability is platform-dependent; readable timed bubbles remain when no voice is available.
- The approved v0.2 game balance supersedes the earlier two-drone abstraction: ten drones, each five seconds out, fifteen seconds scanning, and five seconds back. Two ground teams carry eight people each. The collision, washout, congestion, and their clearance durations are authored gameplay abstractions.
