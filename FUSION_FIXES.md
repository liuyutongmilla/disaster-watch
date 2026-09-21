# Map / simulation synchronization fixes

This build keeps `engine.js` as the single source of truth for rescue state and makes `map.js` reflect that state instead of inventing shelter occupancy.

## 1. Shelter number now grows on physical arrival

Before, the map printed `s.used + s.reserved`. A dispatch increased `reserved` immediately; when the vehicle/convoy arrived, the engine moved the same people from `reserved` to `used`, so the displayed sum did not change.

Now the shelter card shows:
- `used / capacity safe` = residents physically received.
- `+ reserved inbound` = seats/residents committed but not yet arrived.
- the progress bar distinguishes received vs inbound.

Authoritative arrival updates remain in `src/engine.js`:
- rescue vehicles: `updateUnits()`
- boats: `updateSkiff()`
- walking evacuation: `updateEvacuation()`

Presentation is in `src/map.js` around the shelter rendering block.

## 2. Decorative people/cars no longer fake shelter arrivals

The old `map.js` generated ambient pedestrians and traffic that independently routed into shelters. Those objects were visual-only and never belonged to the simulation population, so they could appear to enter a hub without changing counts.

Now:
- ambient pedestrians stay on ordinary streets;
- background cars stay between ordinary blocks;
- only real `state.convoys` and rescue units can visually arrive at shelters.

This prevents the map from showing an arrival that the engine did not record.

## 3. Ground-team movement is synchronized with engine state

Before, the map interpolated a ground team along `unit.trip`, but `unit.position` in the simulation stayed at the previous node until the leg ended. Other logic reading `position` could therefore see a stale location.

Now `src/engine.js -> updateUnits()` updates `u.position` to the current route node while a surface unit moves. Trailer movement is synchronized the same way in `updateSkiff()`.

Ready ground teams are also rendered at their current location in `src/map.js`, so dispatch movement has a visible starting point.

## Validation

`npm test`: 20/20 engine tests pass.

`npm run check`: all JavaScript syntax checks pass.

Two regression tests were added for:
- shelter `reserved -> used` arrival accounting;
- ground-team authoritative position advancing during travel.
