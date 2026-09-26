/**
 * VehiclePhysics - Arcade-Realistic Vehicle Physics Engine
 * Pure JavaScript, Zero Dependencies
 * 
 * Usage:
 *   const physics = new VehiclePhysics(vehicleGroup, chassisGroup);
 *   // In animation loop:
 *   physics.update(deltaTime, { throttle, steering, handbrake, nos });
 *   const telemetry = physics.getTelemetry();
 */

class VehiclePhysics {
  constructor(vehicleRoot, chassisRoot, config = {}) {
    // === ROOT GROUPS ===
    this.vehicleRoot = vehicleRoot; // THREE.Group - rotates yaw, translates XZ
    this.chassisRoot = chassisRoot; // THREE.Group child - handles pitch, roll, suspension

    // === PHYSICS STATE ===
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.angularVelocity = new THREE.Vector3(0, 0, 0); // pitch, yaw, roll rates
    this.position = new THREE.Vector3(0, 0, 0);
    this.yaw = 0; // radians

    // === DRIVETRAIN ===
    this.currentGear = 0; // 0 = reverse, 1-5 = forward
    this.rpm = 0;
    this.nitroFuel = 100;
    this.nitroActive = false;
    this.enginePower = 350; // kW nominal

    // === SUSPENSION & GROUND ===
    this.wheelHeights = [0, 0, 0, 0]; // FL, FR, BL, BR
    this.groundContact = false;
    this.airborneTime = 0;

    // === DRIFT STATE ===
    this.isDrifting = false;
    this.driftAngle = 0; // slip angle in radians
    this.driftPoints = 0;
    this.driftMultiplier = 1.0;
    this.lastNonDriftVelocity = 0;

    // === TUNABLE CONSTANTS ===
    this.mass = config.mass ?? 1300; // kg
    this.brakeTorque = config.brakeTorque ?? 5000; // N⋅m
    this.wheelRadius = config.wheelRadius ?? 0.34; // meters
    this.dragCoeff = config.dragCoeff ?? 0.95; // velocity drag per frame
    this.rollResistance = config.rollResistance ?? 0.015;

    // Suspension
    this.suspensionK = config.suspensionK ?? 25000; // spring stiffness N/m
    this.suspensionC = config.suspensionC ?? 2500; // damping N⋅s/m
    this.suspensionRest = config.suspensionRest ?? 0.4; // rest height (m)
    this.suspensionTravel = config.suspensionTravel ?? 0.3; // max compression

    // Traction
    this.staticFriction = config.staticFriction ?? 1.4; // peak grip coefficient
    this.dynamicFriction = config.dynamicFriction ?? 0.95; // sliding friction
    this.driftFriction = config.driftFriction ?? 0.7; // friction while drifting
    this.tireStiffness = config.tireStiffness ?? 0.18; // slip angle → lateral force slope

    // Drift Assist
    this.driftAssistStrength = config.driftAssistStrength ?? 0.4; // stabilization torque factor
    this.driftThreshold = config.driftThreshold ?? 0.15; // radians slip angle to trigger drift
    this.driftMinSpeed = config.driftMinSpeed ?? 8; // m/s

    // Transmission
    this.gearRatios = [3.5, 0.08, 0.18, 0.35, 0.55, 0.8]; // reverse, 1-5
    this.shiftUpThreshold = 0.8; // RPM ratio
    this.shiftDownThreshold = 0.3;

    // Nitro
    this.nitroPowerMult = 1.9; // acceleration multiplier
    this.nitroTopSpeedMult = 1.45; // top speed increase
    this.nitroFuelDrain = config.nitroFuelDrain ?? 35; // fuel/second
    this.nitroRechargeRate = config.nitroRechargeRate ?? 15; // fuel/second

    // Weight Transfer
    this.pitchSensitivity = config.pitchSensitivity ?? 0.35;
    this.rollSensitivity = config.rollSensitivity ?? 0.12;

    // Dimensions
    this.wheelbase = config.wheelbase ?? 2.7; // meters (for weight distribution)
    this.trackWidth = config.trackWidth ?? 1.6;

    // External callbacks
    this.getGroundHeight = config.getGroundHeight ?? (() => 0);
    this.getRoadOffset = config.getRoadOffset ?? ((z) => ({ x: 0 }));
    this.roadWidth = config.roadWidth ?? 12;

    this.collisionEvents = [];
  }

  /**
   * Main update loop - call once per frame
   * @param {number} dt - Delta time in seconds
   * @param {Object} inputs - { throttle, steering, handbrake, nos }
   */
  update(dt, inputs = {}) {
    const { throttle = 0, steering = 0, handbrake = false, nos = false } = inputs;

    // Clamp inputs
    const th = Math.max(-1, Math.min(1, throttle));
    const st = Math.max(-1, Math.min(1, steering));

    // === GROUND DETECTION ===
    this.updateGroundContact();

    // === SUSPENSION & GRAVITY ===
    this.applySuspension(dt);
    this.applyGravity(dt);

    // === DRIVETRAIN ===
    this.updateDrivetrain(th, nos, dt);

    // === TRACTION & FRICTION ===
    this.updateTraction(th, st, handbrake, dt);

    // === DRIFT DYNAMICS ===
    this.updateDrift(st, dt);

    // === STEERING & ROTATION ===
    this.updateSteering(st, dt);

    // === WEIGHT TRANSFER (PITCH/ROLL) ===
    this.updateWeightTransfer(th, st, dt);

    // === POSITION UPDATE ===
    this.updatePosition(dt);

    // === BOUNDARY COLLISION ===
    this.checkRoadBoundaries();

    // === SYNC TO THREE.JS ===
    this.syncToThreeJS();

    // === TELEMETRY ===
    this.updateTelemetry();
  }

  updateGroundContact() {
    const wheelPositions = [
      [-this.trackWidth / 2, -this.wheelbase / 2], // FL
      [this.trackWidth / 2, -this.wheelbase / 2],   // FR
      [-this.trackWidth / 2, this.wheelbase / 2],   // BL
      [this.trackWidth / 2, this.wheelbase / 2],    // BR
    ];

    let minHeight = Infinity;
    let contactCount = 0;

    for (let i = 0; i < 4; i++) {
      const [xOff, zOff] = wheelPositions[i];
      const wx = this.position.x + xOff * Math.cos(this.yaw) - zOff * Math.sin(this.yaw);
      const wz = this.position.z + xOff * Math.sin(this.yaw) + zOff * Math.cos(this.yaw);

      const groundY = this.getGroundHeight(wx, wz);
      this.wheelHeights[i] = groundY;

      if (this.position.y - groundY < 0.5) {
        contactCount++;
      }
      minHeight = Math.min(minHeight, groundY);
    }

    this.groundContact = contactCount >= 2;
    const targetHeight = minHeight + 0.35; // chassis height above lowest wheel
    
    // Clamp firmly to ground
    if (this.groundContact && this.position.y < targetHeight) {
      this.position.y = targetHeight;
      if (this.velocity.y < 0) this.velocity.y *= 0.3; // absorb landing
    }
  }

  applySuspension(dt) {
    if (!this.groundContact) return;

    const wheelPositions = [
      [-this.trackWidth / 2, -this.wheelbase / 2],
      [this.trackWidth / 2, -this.wheelbase / 2],
      [-this.trackWidth / 2, this.wheelbase / 2],
      [this.trackWidth / 2, this.wheelbase / 2],
    ];

    let totalForce = 0;
    let suspensionCompressions = [];

    for (let i = 0; i < 4; i++) {
      const [xOff, zOff] = wheelPositions[i];
      const wx = this.position.x + xOff * Math.cos(this.yaw) - zOff * Math.sin(this.yaw);
      const wz = this.position.z + xOff * Math.sin(this.yaw) + zOff * Math.cos(this.yaw);

      const groundY = this.wheelHeights[i];
      const chassisY = this.position.y;
      const compression = (chassisY - groundY) - this.suspensionRest;

      suspensionCompressions.push(compression);

      // Damped spring
      const springForce = -this.suspensionK * Math.max(0, compression);
      const damperForce = -this.suspensionC * this.velocity.y;
      const wheelForce = springForce + damperForce;

      totalForce += Math.max(0, wheelForce);
    }

    // Distribute suspension force evenly
    this.velocity.y += (totalForce / this.mass) * dt;
  }

  applyGravity(dt) {
    const g = 9.81;
    if (!this.groundContact) {
      this.velocity.y -= g * dt;
    }
    this.airborneTime = this.groundContact ? 0 : this.airborneTime + dt;
  }

  updateDrivetrain(throttle, nos, dt) {
    // Calculate target RPM from velocity
    const maxRPM = 7000;
    const gearRatio = Math.abs(this.gearRatios[this.currentGear]);
    const speed = this.velocity.length();
    const wheelRPM = (speed / (Math.PI * 2 * this.wheelRadius)) * 60;
    const targetRPM = wheelRPM * gearRatio;

    // Smooth RPM transition
    this.rpm = this.rpm * 0.9 + targetRPM * 0.1;

    // Auto transmission
    const rpmRatio = this.rpm / maxRPM;
    if (this.currentGear > 0 && this.currentGear < 5 && rpmRatio > this.shiftUpThreshold) {
      this.currentGear++;
    } else if (this.currentGear > 1 && rpmRatio < this.shiftDownThreshold) {
      this.currentGear--;
    }

    // Nitro management
    if (nos && this.nitroFuel > 0 && throttle > 0.3) {
      this.nitroActive = true;
      this.nitroFuel = Math.max(0, this.nitroFuel - this.nitroFuelDrain * dt);
    } else {
      this.nitroActive = false;
      this.nitroFuel = Math.min(100, this.nitroFuel + this.nitroRechargeRate * dt);
    }
  }

  updateTraction(throttle, steering, handbrake, dt) {
    const speed = this.velocity.length();
    const maxSpeed = 70; // m/s base (~252 km/h)
    const adjustedMaxSpeed = this.nitroActive ? maxSpeed * this.nitroTopSpeedMult : maxSpeed;

    // Traction force
    let tractionForce = 0;
    if (this.groundContact && this.currentGear !== 0) {
      const maxTraction = this.mass * 9.81 * this.staticFriction;
      const powerOutput = this.enginePower * 1000 * Math.abs(throttle);
      const nitroMult = this.nitroActive ? this.nitroPowerMult : 1.0;

      tractionForce = (powerOutput * nitroMult) / Math.max(1, speed);
      tractionForce = Math.min(tractionForce, maxTraction);

      // Gear penalty
      if (this.currentGear === 1) tractionForce *= 1.3;
      else if (this.currentGear === 5) tractionForce *= 0.7;

      // Apply throttle direction
      if (this.currentGear === 0) tractionForce *= -0.6; // reverse is slower
      else if (throttle < 0) tractionForce *= -0.8; // braking
    }

    // Drag and rolling resistance
    let dragForce = speed * speed * this.dragCoeff * 0.3;
    let rollingResistance = speed * this.rollResistance;

    if (throttle < 0 || handbrake) {
      // Braking
      dragForce += this.brakeTorque / this.wheelRadius * 0.5;
    }

    const netForce = tractionForce - dragForce - rollingResistance;
    const acceleration = netForce / this.mass;

    // Forward direction in world space
    const forward = new THREE.Vector3(
      Math.sin(this.yaw),
      0,
      Math.cos(this.yaw)
    );

    // Apply acceleration
    forward.multiplyScalar(acceleration * dt);
    this.velocity.add(forward);

    // Cap speed
    if (this.velocity.length() > adjustedMaxSpeed) {
      this.velocity.normalize().multiplyScalar(adjustedMaxSpeed);
    }
  }

  updateDrift(steering, dt) {
    const speed = this.velocity.length();
    const sideways = new THREE.Vector3(
      Math.cos(this.yaw),
      0,
      -Math.sin(this.yaw)
    );

    // Lateral velocity (slip angle)
    const lateralVelocity = this.velocity.dot(sideways);
    const slipAngle = Math.atan2(lateralVelocity, Math.max(speed, 1));

    // Drift initiation
    const exceedsDriftThreshold = Math.abs(slipAngle) > this.driftThreshold;
    const driftSpeed = speed > this.driftMinSpeed;

    if ((exceedsDriftThreshold && driftSpeed) || this.isDrifting) {
      this.isDrifting = true;
      this.driftAngle = slipAngle;

      // Accumulate drift points
      const driftIntensity = Math.abs(slipAngle) / Math.PI;
      this.driftPoints += driftIntensity * 10 * dt;
      this.driftMultiplier = 1.0 + Math.min(driftIntensity * 0.5, 0.3);
    } else {
      this.isDrifting = false;
      this.driftPoints = 0;
      this.driftMultiplier = 1.0;
    }

    // Exit drift if speed drops too low
    if (speed < this.driftMinSpeed * 0.5) {
      this.isDrifting = false;
    }
  }

  updateSteering(steering, dt) {
    const speed = this.velocity.length();
    const steeringResponsiveness = 0.12; // radians per unit input

    // Steering angle decreases at high speed
    let steeringEffect = steeringResponsiveness * steering;
    steeringEffect *= Math.max(0.3, 1 - speed / 100);

    // Handbrake + steering triggers sharper turns
    const handbrakeBoost = 1.2;

    // Apply yaw torque (Ackermann-like)
    this.angularVelocity.y = this.angularVelocity.y * 0.85 + steeringEffect * speed * 0.08 * dt;
    this.yaw += this.angularVelocity.y * dt;

    // Normalize yaw
    this.yaw = ((this.yaw + Math.PI) % (2 * Math.PI)) - Math.PI;

    // Velocity direction aligns with yaw slowly
    const forward = new THREE.Vector3(
      Math.sin(this.yaw),
      0,
      Math.cos(this.yaw)
    );

    const forwardSpeed = this.velocity.dot(forward);
    const targetVelocity = forward.multiplyScalar(forwardSpeed);

    // Blend velocity toward heading
    const blendFactor = Math.min(0.1 * dt * speed, 0.2);
    this.velocity.lerp(targetVelocity, blendFactor);
  }

  updateWeightTransfer(throttle, steering, dt) {
    const speed = this.velocity.length();
    const forward = new THREE.Vector3(
      Math.sin(this.yaw),
      0,
      Math.cos(this.yaw)
    );

    // Calculate local accelerations
    const accelForward = throttle * 15; // subjective m/s²
    const accelLateral = steering * speed * 0.15;

    // Pitch: nose lifts on throttle, dives on braking
    const pitchAccel = -accelForward * this.pitchSensitivity;
    this.angularVelocity.x = this.angularVelocity.x * 0.92 + pitchAccel * 0.08;
    const currentPitch = this.chassisRoot.rotation.x || 0;
    this.chassisRoot.rotation.x = currentPitch * 0.95 + this.angularVelocity.x * dt * 0.1;
    this.chassisRoot.rotation.x = Math.max(-0.3, Math.min(0.3, this.chassisRoot.rotation.x));

    // Roll: leans outward in turns
    const rollAccel = accelLateral * this.rollSensitivity * (speed / 30);
    this.angularVelocity.z = this.angularVelocity.z * 0.92 + rollAccel * 0.08;
    const currentRoll = this.chassisRoot.rotation.z || 0;
    this.chassisRoot.rotation.z = currentRoll * 0.95 + this.angularVelocity.z * dt * 0.1;
    this.chassisRoot.rotation.z = Math.max(-0.25, Math.min(0.25, this.chassisRoot.rotation.z));
  }

  updatePosition(dt) {
    this.position.add(this.velocity.clone().multiplyScalar(dt));
  }

  checkRoadBoundaries() {
    const offset = this.getRoadOffset(this.position.z);
    const boundaryX_Min = offset.x - this.roadWidth / 2;
    const boundaryX_Max = offset.x + this.roadWidth / 2;

    let collided = false;

    if (this.position.x < boundaryX_Min) {
      this.position.x = boundaryX_Min + 0.2;
      const impulse = Math.abs(this.velocity.x) * this.mass;
      this.velocity.x = -this.velocity.x * 0.3;
      collided = true;

      this.collisionEvents.push({
        position: this.position.clone(),
        impulse,
        side: 'left',
        time: Date.now()
      });
    } else if (this.position.x > boundaryX_Max) {
      this.position.x = boundaryX_Max - 0.2;
      const impulse = Math.abs(this.velocity.x) * this.mass;
      this.velocity.x = -this.velocity.x * 0.3;
      collided = true;

      this.collisionEvents.push({
        position: this.position.clone(),
        impulse,
        side: 'right',
        time: Date.now()
      });
    }

    if (collided) {
      // Scrape friction
      this.velocity.multiplyScalar(0.95);
    }
  }

  syncToThreeJS() {
    // Update vehicle root position and yaw rotation
    this.vehicleRoot.position.copy(this.position);
    this.vehicleRoot.rotation.order = 'YXZ';
    this.vehicleRoot.rotation.y = this.yaw;

    // Chassis handles pitch/roll (already set in updateWeightTransfer)
    this.chassisRoot.position.y = 0; // local to vehicle
  }

  updateTelemetry() {
    // Telemetry is cached here for getTelemetry()
  }

  /**
   * Get current telemetry data
   */
  getTelemetry() {
    const speed = this.velocity.length();
    const speedKmh = speed * 3.6;

    return {
      speed,
      speedKmh,
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      yaw: this.yaw,
      rpm: Math.round(this.rpm),
      currentGear: this.currentGear === 0 ? 'R' : this.currentGear,
      rpmRatio: this.rpm / 7000,
      nitroFuel: Math.round(this.nitroFuel),
      nitroActive: this.nitroActive,
      isDrifting: this.isDrifting,
      driftAngle: this.driftAngle * (180 / Math.PI), // degrees
      driftPoints: Math.round(this.driftPoints),
      driftMultiplier: this.driftMultiplier.toFixed(2),
      groundContact: this.groundContact,
      airborneTime: this.airborneTime.toFixed(2),
      collisions: this.collisionEvents.splice(0) // drain events
    };
  }

  /**
   * Reset vehicle state
   */
  reset(x = 0, y = 0, z = 0, yaw = 0) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.yaw = yaw;
    this.currentGear = 1;
    this.rpm = 0;
    this.isDrifting = false;
    this.driftAngle = 0;
    this.driftPoints = 0;
    this.nitroFuel = 100;
    this.nitroActive = false;
    this.airborneTime = 0;

    this.vehicleRoot.position.copy(this.position);
    this.vehicleRoot.rotation.y = this.yaw;
    this.chassisRoot.rotation.set(0, 0, 0);
  }
}

export default VehiclePhysics;
