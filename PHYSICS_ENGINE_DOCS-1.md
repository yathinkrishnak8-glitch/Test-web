# VehiclePhysics - Arcade-Realistic Physics Engine Documentation

## Overview

A pure JavaScript vehicle physics engine designed for arcade-style racing games with realistic dynamics. Built for Three.js, zero external dependencies, and optimized for ~60 FPS performance.

**Key Features:**
- Realistic drivetrain with automatic transmission
- Suspension system with damped harmonic motion
- Advanced drift detection and assist
- Dynamic weight transfer (pitch/roll)
- Nitrous oxide system
- Road boundary collision with scrape physics
- Telemetry output for HUD integration

---

## Architecture

### Class Structure

```javascript
const physics = new VehiclePhysics(vehicleRoot, chassisRoot, config);
physics.update(deltaTime, inputs);
const telemetry = physics.getTelemetry();
```

**Parameters:**
- `vehicleRoot` (THREE.Group): World-space group handling position & yaw rotation
- `chassisRoot` (THREE.Group): Local-space child group handling pitch & roll
- `config` (Object): Physics constants (see Tuning section)

### Input Object

```javascript
{
  throttle: -1 to 1,    // -1 = full reverse braking, 0 = coast, 1 = full throttle
  steering: -1 to 1,    // -1 = full left, 0 = straight, 1 = full right
  handbrake: boolean,   // true = locked rear wheels for drifting
  nos: boolean          // true = nitrous oxide active (if fuel available)
}
```

### Telemetry Output

```javascript
{
  speed,              // m/s
  speedKmh,           // km/h
  position,           // THREE.Vector3 world position
  velocity,           // THREE.Vector3 world velocity
  yaw,                // radians (-π to π)
  rpm,                // engine RPM (0-7000)
  currentGear,        // 'R', 1-5, or 0
  rpmRatio,           // 0-1, normalized to max RPM
  nitroFuel,          // 0-100%
  nitroActive,        // boolean
  isDrifting,         // boolean
  driftAngle,         // degrees (-180 to 180)
  driftPoints,        // accumulated drift score
  driftMultiplier,    // 1.0 to ~1.3 while drifting
  groundContact,      // boolean
  airborneTime,       // seconds airborne
  collisions: [       // array of collision events
    {
      position,       // THREE.Vector3
      impulse,        // N⋅s (newton-seconds)
      side,           // 'left' or 'right'
      time            // milliseconds (Date.now())
    }
  ]
}
```

---

## Physics Systems

### 1. Drivetrain & Transmission

**Automatic Gear Shifting**
- 5 forward gears + reverse
- Gear ratios tuned for realistic acceleration curves
- Automatic upshift at 80% RPM, downshift at 30%
- Reverse has reduced traction (60% of forward power)

**Power Delivery**
- Engine power: 350 kW nominal
- Throttle modulates power output linearly
- First gear multiplier: 1.3x (low-end torque boost)
- Fifth gear multiplier: 0.7x (highway efficiency)
- Speed-dependent drivetrain losses included

**Config:**
```javascript
{
  enginePower: 350,              // kW
  gearRatios: [3.5, 0.08, ...],  // custom ratios per gear
  shiftUpThreshold: 0.8,         // RPM ratio trigger
  shiftDownThreshold: 0.3        // RPM ratio trigger
}
```

### 2. Suspension & Ground Contact

**Damped Spring Model**
```
F = -k * compression - c * velocity
```

Where:
- k = suspension stiffness (N/m)
- c = damping coefficient (N⋅s/m)
- compression = current deflection from rest height

**Ground Raycast Integration**
- Samples 4 wheel positions each frame
- Calls `getGroundHeight(x, z)` callback
- Requires minimum 2-wheel contact to consider grounded
- Clamps vertical position to prevent clipping

**Config:**
```javascript
{
  suspensionK: 25000,           // spring stiffness
  suspensionC: 2500,            // damping
  suspensionRest: 0.4,          // rest height in meters
  suspensionTravel: 0.3,        // max compression
  wheelRadius: 0.34,            // wheel radius (for RPM calcs)
  wheelbase: 2.7,               // distance front-rear wheels
  trackWidth: 1.6               // distance left-right wheels
}
```

### 3. Traction & Friction

**High-Speed Dynamics**
- Static friction coefficient: 1.4 (peak grip)
- Dynamic friction: 0.95 (sliding grip)
- Drift friction: 0.7 (reduced grip while sliding)

**Drag Forces**
- Aerodynamic drag: `v² × dragCoeff × 0.3`
- Rolling resistance: `v × rollResistance`
- Braking friction: `brakeTorque / wheelRadius`

**Speed Capping**
- Base max speed: 70 m/s (~252 km/h)
- With nitro boost: 70 × 1.45 = 101.5 m/s (~365 km/h)

**Config:**
```javascript
{
  staticFriction: 1.4,           // peak grip coefficient
  dynamicFriction: 0.95,         // sliding grip
  driftFriction: 0.7,            // drift slip grip
  dragCoeff: 0.95,               // velocity drag factor
  rollResistance: 0.015,         // rolling resistance
  brakeTorque: 5000              // max braking N⋅m
}
```

### 4. Drift System & Drift Assist

**Drift Mechanics**
- Triggers when slip angle exceeds threshold (~8.6°) at speed > 8 m/s
- Slip angle = `atan2(lateralVelocity, forwardVelocity)`
- Continuous drift accumulation while maintaining slip

**Drift Assist Stabilization**
- Prevents uncontrollable 360° spins
- Applies subtle counter-steering torque
- Maintains smooth, controllable slide angles
- Multiplies steering response during drift for precision control

**Drift Scoring**
- Points accumulate based on slip angle intensity
- Score multiplier: `1.0 + (intensity × 0.5)` during drift
- Resets when exiting drift or speed drops below threshold

**Config:**
```javascript
{
  driftThreshold: 0.15,          // radians (~8.6°)
  driftMinSpeed: 8,              // m/s minimum for drift
  driftAssistStrength: 0.4,      // stabilization factor (0-1)
  tireStiffness: 0.18            // slip angle → force slope
}
```

### 5. Nitrous Oxide System

**Power Boost**
- Acceleration multiplier: 1.9x (doubles engine torque)
- Top speed increase: 1.45x (70 m/s → 101.5 m/s)
- Activates when: throttle > 0.3 AND fuel > 0 AND nos input true

**Fuel Management**
- Max tank: 100%
- Drain rate: 35% per second while active
- Recharge rate: 15% per second while idle
- Requires throttle input to activate (can't boost neutral)

**Config:**
```javascript
{
  nitroPowerMult: 1.9,           // acceleration multiplier
  nitroTopSpeedMult: 1.45,       // top speed multiplier
  nitroFuelDrain: 35,            // %/second drain
  nitroRechargeRate: 15          // %/second recharge
}
```

### 6. Weight Transfer (Dynamic Pitch/Roll)

**Pitch Dynamics**
- Nose lifts on throttle (negative pitch)
- Nose dives under braking (positive pitch)
- Factor: `pitchSensitivity = 0.35`
- Clamped to ±0.3 radians (±17°)

**Roll Dynamics**
- Chassis leans outward during high-speed turns
- Factor: `rollSensitivity = 0.12 × (speed / 30)`
- Clamped to ±0.25 radians (±14°)
- Creates visual weight shift and affects perceived grip

**Calculation:**
```
pitchAccel = -throttle × pitchSensitivity
rollAccel = steering × speed × 0.15 × rollSensitivity
```

**Config:**
```javascript
{
  pitchSensitivity: 0.35,        // nose up/down intensity
  rollSensitivity: 0.12          // lean intensity
}
```

### 7. Road Boundaries & Collision

**Boundary Detection**
- Queries road center via `getRoadOffset(z)` callback
- Enforces `±roadWidth/2` constraint on X position
- Typical road width: 12 meters (6m each side of center)

**Collision Response**
- Immediate penetration resolution (clamp to boundary + 0.2m)
- Velocity bounce: `-velocity × 0.3` (inelastic)
- Scrape friction: `velocity × 0.95` (drag)
- Collision event fired with position, impulse, side

**Config:**
```javascript
{
  roadWidth: 12,                 // total road width in meters
  getRoadOffset: (z) => ({ x }),  // callback returns road center offset
  getRoadHeight: (x, z) => {},    // callback for elevation
}
```

---

## Integration Guide

### Basic Setup

```javascript
import VehiclePhysics from './VehiclePhysics.js';

// Create vehicle hierarchy
const vehicleRoot = new THREE.Group();
const chassisRoot = new THREE.Group();
vehicleRoot.add(chassisRoot);
scene.add(vehicleRoot);

// Add visual meshes to chassisRoot (body, wheels, lights, etc.)

// Create physics
const physics = new VehiclePhysics(vehicleRoot, chassisRoot, {
  mass: 1300,
  getGroundHeight: (x, z) => {
    // Return ground elevation at world position (x, z)
    return terrainHeightmap.getHeight(x, z);
  },
  getRoadOffset: (z) => {
    // Return { x } center offset of road at z position
    return { x: trackCurve.getOffset(z) };
  },
  roadWidth: 12
});

// Reset to start position
physics.reset(0, 2, 0, 0); // x, y, z, yaw

// In animation loop:
physics.update(deltaTime, {
  throttle,
  steering,
  handbrake,
  nos
});

// Get telemetry for HUD
const telemetry = physics.getTelemetry();
```

### Ground Height Callback

Implement height-based raycasting or heightmap sampling:

```javascript
// Flat ground
getGroundHeight: (x, z) => 0

// With elevation
getGroundHeight: (x, z) => Math.sin(z * 0.01) * 5 + heightmap[Math.floor(z)][Math.floor(x)]

// Layered terrain with barriers
getGroundHeight: (x, z) => {
  if (Math.abs(x) > 30) return -1000; // out of bounds
  return terrainHeightmap.sample(x, z) + grassHeight;
}
```

### Road Offset Callback

For curved tracks:

```javascript
// Straight road
getRoadOffset: (z) => ({ x: 0 })

// Sine wave
getRoadOffset: (z) => ({ x: Math.sin(z * 0.02) * 3 })

// Spline-based track
getRoadOffset: (z) => ({ x: trackSpline.getOffsetAtZ(z) })
```

### HUD Display Example

```javascript
function updateHUD(telemetry) {
  const text = `
Speed:   ${telemetry.speedKmh.toFixed(1)} km/h
Gear:    ${telemetry.currentGear}
RPM:     ${telemetry.rpm}
Throttle: ${(telemetry.rpmRatio * 100).toFixed(0)}%
Drift:   ${telemetry.isDrifting ? 'YES (' + telemetry.driftPoints + 'pt)' : 'No'}
Nitro:   ${telemetry.nitroFuel.toFixed(0)}% ${telemetry.nitroActive ? 'ACTIVE' : ''}
  `;
  
  // Handle collisions
  if (telemetry.collisions.length > 0) {
    telemetry.collisions.forEach(collision => {
      playSound('crash', collision.impulse / 1000);
      createSparks(collision.position, collision.side);
    });
  }
}
```

---

## Physics Tuning Guide

### For More Arcade Feel

```javascript
{
  dragCoeff: 0.7,              // reduce drag for higher top speed
  suspensionK: 20000,          // softer suspension (bouncier)
  suspensionC: 1500,           // less damping (more oscillation)
  staticFriction: 1.6,         // higher grip (easier to grip)
  driftThreshold: 0.2,         // higher threshold (easier to initiate)
  pitchSensitivity: 0.5,       // exaggerated nose movement
  rollSensitivity: 0.2         // exaggerated lean
}
```

### For More Simulation Feel

```javascript
{
  dragCoeff: 1.2,              // realistic drag
  suspensionK: 30000,          // stiff suspension
  suspensionC: 3500,           // heavy damping
  staticFriction: 1.2,         // lower grip threshold
  driftThreshold: 0.1,         // sensitive drift trigger
  pitchSensitivity: 0.25,      // subtle pitch
  rollSensitivity: 0.08        // subtle roll
}
```

### For High-Speed Stability

```javascript
{
  dragCoeff: 1.0,              // increase drag
  staticFriction: 1.5,         // higher grip
  tireStiffness: 0.25,         // more responsive steering
  driftAssistStrength: 0.6,    // stronger drift stability
}
```

### For Drifting Focus

```javascript
{
  driftThreshold: 0.12,        // easier to initiate
  driftFriction: 0.8,          // more grip while sliding
  driftAssistStrength: 0.3,    // less interference
  driftMinSpeed: 6,            // lower speed requirement
  staticFriction: 1.3,         // grip for entry
}
```

---

## Performance Optimization

**Frame Time Budget: ~16.67ms @ 60fps**

### Current Complexity
- Ground raycast: 4 samples/frame = 4 callback invocations
- Physics updates: O(1) per system
- No physics object pooling (minimal allocations)
- Garbage collection: <1 allocation per frame (Vector3 clones only in telemetry)

### Optimization Tips

1. **Callback Caching**
   - Pre-compute road offsets at key Z positions
   - Cache heightmap samples using chunking
   - Avoid expensive raycasts in callbacks

2. **Update Rate Throttling**
   - Could reduce ground checks to 2 wheels per frame (temporal distribution)
   - Skip non-critical updates (telemetry accumulation)

3. **Mobile Optimization**
   ```javascript
   // Reduce precision on mobile
   const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
   const physicsFrequency = isMobile ? 0.5 : 1.0; // half update rate
   ```

---

## Advanced Features

### Custom Gear Ratios

```javascript
const physics = new VehiclePhysics(vehicleRoot, chassisRoot, {
  gearRatios: [3.5, 0.06, 0.15, 0.30, 0.50, 0.70], // custom ratios
  // Lower numbers = higher top speed per gear
  // Higher numbers = more acceleration
});
```

### Multi-Track Support

```javascript
// Dynamic road width and curvature
getRoadOffset: (z) => {
  if (z < 100) return { x: 0 }; // straight section
  if (z < 200) {
    // Left turn
    return { x: -Math.sin((z - 100) / 100 * Math.PI) * 5 };
  }
  return { x: 0 };
},
roadWidth: 12  // adjust per section as needed
```

### Jump/Ramp Physics

Physics engine automatically handles:
- Airborne time when `getGroundHeight` returns below position
- Gravity application during flight
- Landing impact absorption

```javascript
getGroundHeight: (x, z) => {
  const baseHeight = 0;
  // Ramp from z=50 to z=80
  if (z >= 50 && z <= 80) {
    return baseHeight + (z - 50) * 0.2;
  }
  // Jump gap from z=80 to z=120
  if (z > 80 && z < 120) {
    return baseHeight - 10; // "cliff"
  }
  return baseHeight;
}
```

---

## Common Issues & Solutions

### "Car clips through ground"
- Check `getGroundHeight` is returning accurate values
- Increase `suspensionRest` (chassis ride height)
- Verify 4-wheel ground detection is working

### "Drifting feels uncontrollable"
- Increase `driftAssistStrength` (0.4 → 0.6)
- Decrease `driftThreshold` (0.15 → 0.1)
- Verify steering input is being applied correctly

### "Car feels too slidey"
- Increase `staticFriction` (1.4 → 1.6)
- Increase `tireStiffness` (0.18 → 0.25)
- Decrease `dragCoeff` (0.95 → 0.7)

### "Performance drops on complex tracks"
- Optimize `getGroundHeight()` callback (avoid raycasts, use heightmaps)
- Reduce update frequency on mobile
- Profile in Chrome DevTools (Timeline → evaluate frame times)

---

## Vehicle Specifications Reference

**Base Car Stats**
| Attribute | Value | Unit |
|-----------|-------|------|
| Mass | 1300 | kg |
| Engine Power | 350 | kW |
| Max RPM | 7000 | RPM |
| Base Top Speed | 70 | m/s (252 km/h) |
| 0-100 km/h | ~3.8 | seconds |
| Wheelbase | 2.7 | m |
| Track Width | 1.6 | m |

**Suspension**
| Attribute | Value | Unit |
|-----------|-------|------|
| Spring Stiffness | 25000 | N/m |
| Damping Coeff | 2500 | N⋅s/m |
| Rest Height | 0.4 | m |
| Max Travel | 0.3 | m |

---

## License

Free to use in personal and commercial projects. Developed for arcade racing games, compatible with Three.js.

**Dependencies:** THREE.js r128+ (CDN or npm)

---

## Support & Customization

For custom vehicle classes, weight distributions, or multi-vehicle systems, extend the base class:

```javascript
class SportsCar extends VehiclePhysics {
  constructor(vehicleRoot, chassisRoot) {
    super(vehicleRoot, chassisRoot, {
      mass: 1100,           // lighter
      enginePower: 450,     // more powerful
      suspensionK: 30000,   // stiffer
      staticFriction: 1.5   // better grip
    });
  }
}

class Truck extends VehiclePhysics {
  constructor(vehicleRoot, chassisRoot) {
    super(vehicleRoot, chassisRoot, {
      mass: 2500,           // heavier
      enginePower: 250,     // less powerful
      suspensionK: 20000,   // softer
      staticFriction: 1.2   // less grip
    });
  }
}
```

---

**Last Updated:** 2026  
**Version:** 1.0 Stable
