# Prototype v0.3 validation

Completed 19 September 2026.

`npm test`: **18 simulation tests passed**. Coverage includes population conservation; pickup vs. hub-arrival credit; full-load capacity reservations; two-stage boat towing, launch, floodwater access and recovery; ten independent reconnaissance drones and return-flight occupancy; incorrect AI locations and manual correction; rejection consequences; duplicates; guided evacuation; road rerouting; outage and recovery; all AI controls initially off; direct-source dispatch; ground-only road work; persistent road closures; congestion travel cost; empty-area search and return; and rejecting post-mission changes.

`npm run check`: all five browser JavaScript modules pass syntax checks.

`npm run test:browser`: **37 browser checks passed**. Coverage includes:

- All assistant functions initially off and reset to off on replay.
- A quiet opening with an empty Radio panel before the first incoming message.
- Full-screen blurred pause coverage, stopped simulation time, and `Esc` resume.
- Four category controls with quantities 2 ground / 2 boats / 1 helicopter / 10 drones.
- Pointer dragging a drone and ground vehicle onto the map.
- Boat towing to a launch site and rejection of direct deployment into a dry inland sector.
- Count decrement on launch, scan completion, and availability restored only after return.
- Visible rejection feedback for an already-assigned destination.
- Ground-crew road response, work completion, and return.
- Chat noise filtering, per-unit radio focus (including the rescue-boat water filter) and optional AI assessment.
- English speech invocation, left-side colleague bubble, and fade after the speech-end callback.
- Help does not pause simulation.
- Report correction and compact relay degradation/recovery indication.
- Fixed page with separately scrolling chat at 1366×768, 1280×720, and 1920×1080.
- Expanded report-local evidence, correction, hub, and dispatch actions.
- A 390×844 fixed-screen layout check.
- Mission completion, JSON export with conserved population, and reset.
- No browser exceptions or resource errors.

Screenshots: `artifacts/command-desktop.png`, `pause-desktop.png`, `boat-deployment-desktop.png`, `road-response-desktop.png`, `outage-desktop.png`, `command-wide.png`, `command-mobile.png`, `debrief-desktop.png`.

The browser test injects accelerated time and a deterministic speech adapter to exercise speech callbacks. Production uses native browser speech synthesis. This checks the dialogue lifecycle, **not audible quality or native voice availability**. Physical-device touch/audio and real English voice listening have not been validated. No educational effectiveness claim is made.
