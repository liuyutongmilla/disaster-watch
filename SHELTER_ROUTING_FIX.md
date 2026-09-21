# Shelter routing + occupancy fix

## What was wrong

`updateEvacuation()` used a hard-coded automatic destination:

```js
point(b.id).x < 2 ? state.shelters[0] : state.shelters[2]
```

That meant unguided residents could only choose S1 or S3. S2 (Summit Hub) and S4 (West Ridge Refuge) were bypassed unless the player explicitly broadcast guidance to them.

The ambient pedestrians and traffic were also visual-only wandering traffic, so their apparent motion did not match the evacuation routing model.

## What changed

- Added `evacuationPlan(state, blockId, preferredId)` in `src/engine.js`.
- Automatic evacuation now chooses the shortest currently reachable shelter with free capacity.
- A player-guided shelter remains preferred while it is reachable and has space.
- Ties favor the less-loaded shelter.
- Walking evacuation starts on the normal 8-second evacuation tick instead of waiting for 30 seconds.
- `src/map.js` imports and reuses `evacuationPlan()` so pedestrian and traffic visuals head toward the same shelters as the simulation.
- Ambient pedestrians stop wandering back and forth and move one-way toward their shelter.
- Ambient civilians are only spawned from blocks that still have walkers and a reachable shelter.
- Civilian road traffic now routes toward reception hubs.
- Shelter occupancy is still authoritative in `engine.js`: `used` rises only when a real convoy or rescue cargo arrives; decorative traffic never creates population.

## Verification

`npm run check` passes.

`npm test` passes 21/21 tests, including a regression test confirming both Summit Hub and West Ridge receive automatic evacuees.
