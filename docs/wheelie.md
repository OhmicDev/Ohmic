# Auto-wheelie

Pin the throttle and lean back: the scooter lifts its front wheel and holds it at a set angle. Lean forward and it speeds up; lean back and it slows down. Let go of the throttle and it lands. This works like the throttle-and-lean wheelie on Antic and Moxin bikes.

It runs as a LispBM program on the motor controller (VESC firmware 6.05 or newer), so it keeps working if the phone disconnects. Ohmic installs it, calibrates the IMU, arms and disarms it, holds the settings and shows what it's doing live.

- The program: [`src/onboard/wheelie.lisp`](../src/onboard/wheelie.lisp), commented, with every tunable named at the top.
- Settings, calibration math and the program builder: [`src/onboard/wheelie.ts`](../src/onboard/wheelie.ts).
- Install, arm and calibrate: [`src/state/wheelie.ts`](../src/state/wheelie.ts). The page: Features → Auto-wheelie.
- Tests: [`src/onboard/wheelie.test.ts`](../src/onboard/wheelie.test.ts) runs the real program in a LispBM interpreter ([`lispbm.ts`](../src/onboard/lispbm.ts)) against a scooter-and-rider simulation ([`wheelieSim.ts`](../src/sim/wheelieSim.ts)). [`wheelieFlow.test.ts`](../src/state/wheelieFlow.test.ts) runs the app side against the demo controller.

> **It has only been tested in simulation.** Read [Safety](#safety) before you ride, and follow the [bench test](#bench-test) first.

---

## 1. Control design

### Block diagram

```
                      ┌──────────────────────── controller that reads the throttle (runs the program, 100 Hz) ──────────────────────┐
 throttle (ADC/PPM) ──┤► trigger (pin, let go) ─┐                                                                                    │
                      │                         ▼                                                                                    │
 IMU gyro + accel ────┤► pitch estimate ──► state machine ──► control law ──► limits ──► rear motor  (set-current / set-brake)     │
                      │   (gyro, pulled to   (armed, lifting,  (PD + I,        (kick,      front motor (canset-current over CAN)     │
 rear wheel speed ────┤►  gravity while the   holding, …)       catch, land)    hold, …)   app-disable-output 50 ms each tick ───────┤──► throttle app
                      │   front is down)          ▲                                                                                  │    (off while the
 battery V/A, temps,──┤► safety checks ───────────┘  ends: let go, time, speed, brake, roll, yaw, heat, battery, IMU, CAN, fault      │     program drives)
 faults, CAN status   │                                                                                                              │
                      └──── tones (foc-play-tone) ◄── state changes        live data (send-data, 20 Hz) ──► Ohmic ───────────────────┘
```

### States

```
             Ohmic arms it                pin (speed ok, battery ok,      nose reaches target
 OFF (0) ─────────────────► ARMED (1) ───── level, not too full) ──► LIFTING (2) ─────────────────► HOLDING (3)
   ▲      ◄─ disarm / timeout ─┘ │ ▲                                    │  │                          │  │
   │                             │ │ said no (low tone)                 │  └─ front didn't lift ──┐    │  │
   │                             │ └────────────────────────────────────┘                         │    │  │
   │                             │                                                                ▼    ▼  │
   │                             │                           past cut-out angle ──► CATCHING (4) ──► LANDING (5)
   │                             │                                                                     │  │ any end:
   │                             │                                                                     ▼  │ let go, time,
   │                             └─ handback once the throttle is let go ◄── WAITING (6) ◄─────────────┘  │ speed, brake,
   │                                                                          ▲                         │ roll, heat …
   └── safety stops disarm ◄──────────────────────────────────────────────────┤
                                     IMU / CAN / loop / controller fault ─► STOPPED (7): free-wheel, then off
```

| State | What it does | Leaves when |
|---|---|---|
| Armed | Watches the throttle. The motors are the throttle's as usual. | Pin (to Lifting, or a low tone and a reason when it can't start); disarm; armed too long without a wheelie (disarms). |
| Lifting | Ramps the rear push to the kick; the front motor adds its share while its wheel is down, then keeps that wheel at road speed. | Nose near the target (to Holding). Past the cut-out angle (Catching). No lift within 1.2 s (lands, reason 17). Any end reason. |
| Holding | The control law below. | Past the cut-out angle; time limit; any end reason; the front came down (24). |
| Catching | Brakes the rear wheel up to *most braking*. | Nose 3° below the cut-out (to Landing) or 1.5 s. |
| Landing | The nose follows a target falling at 15°/s; push only falls away, braking allowed. | Front down and no longer falling (to Waiting). |
| Waiting | Both motors free-wheel, a reminder tone every 0.6 s. | Throttle below 10 %, plus the throttle app's ramp time: the throttle has the motors back. |
| Stopped | After an IMU, CAN, loop or controller fault: free-wheel, then disarm. | — |

It's **disarmed at every power-up**: the stored script only defines things and waits. Ohmic arms it. Typing `(wl-start)` in the LispBM console also works, but skips Ohmic's checks (regen, ABS, settings that fit the motors, calibration sent).

### The math

**Pitch.** The firmware's own pitch (`get-imu-rpy`) is fooled by hard acceleration, which is exactly when a wheelie starts. The program keeps its own, in degrees, nose up from riding level:

```
θ ← θ + ω·dt                                   ω = gyro · side axis   (from the calibration)
while the front is down and |accel| ≈ 1 g (±0.15):
θ ← θ + (θ_g − θ)·dt/0.4 s
θ_g = atan2(a_fwd, a_up) − atan(a_wheel / g) − zero
```

`a_fwd` and `a_up` are the accelerometer along the scooter's forward and up axes, and `a_wheel` is the rear wheel's acceleration from its speed. All three are smoothed the same way (about 50 ms), so subtracting the wheel's acceleration leaves only gravity even while the push changes. `zero` is the deck angle with you standing on it (rear suspension sag), from calibration. Up on the rear wheel the angle comes from the gyro alone; a second or two of drift is far below a degree.

**Why lean controls speed.** Take moments about the rear tyre. With the centre of mass (rider and scooter, mass *m*) a horizontal distance *d′* ahead of the rear axle and *h′* above it at angle θ:

```
J·θ̈ = τ_R + m·h′·a − m·g·d′          d′ = d·cosθ − h·sinθ ,  h′ = d·sinθ + h·cosθ
a  ≈ τ_R / (R·M)                     (the rear motor's push accelerates the scooter)
```

Holding still in pitch (θ̈ = 0) needs `τ_R·(1 + m·h′/(M·R)) = m·g·d′`.
- **Centre of mass ahead of the axle (d′ > 0):** holding needs push, push accelerates you. Leaning forward means more push, so you go faster.
- **Behind (d′ < 0):** holding needs braking, so you slow down.
- **The balance point** is d′ = 0, at θ_bal = atan(d/h).
- For a standing rider (d ≈ 0.4 m, h ≈ 0.85 m), upright is about 25°. Leaning back 0.2 m brings the balance point to about 13°.

So the hold angle is fixed and **your lean is the speed control**, as on the Antic and Moxin bikes. *Back* means slow down, never reverse: the program never drives backwards.

**Lifting.** With no grip on the front tyre at lift-off, only the rear motor pushes the scooter. The front lifts when:

```
m·g·d  <  m·h·a + τ_R + τ_F        →        d_max ≈ h·τ_R/(R·M·g) + (τ_R + τ_F)/(m·g)
```

For a 110 kg scooter and rider, 10-inch wheels and two 50 A hub motors (about 30 N·m each), d_max is about 0.2–0.25 m. **Standing upright (d ≈ 0.4 m), the motors can't lift it: you must lean back as you pin.** The front motor helps only through its reaction torque.

**Control law (Holding).** With the error e = target − θ (degrees) and the pitch rate ω (deg/s, smoothed over 20 ms):

```
u_PD = Kp·e·(catch gain if e < 0) − Kd·ω
I    ← clamp(I + Ki·e·dt, −catch max, most push)
out  ← toward(clamp(u_PD + I, −catch max, most push), at ≤ 800 A/s)
```

- Negative `out` is braking (`set-brake`), never reverse.
- `I` is the steady push your stance needs. It starts at half of what the kick reached, or at what the last wheelie settled on, so there's no jump at the handover.
- The handover to Holding happens a quarter-second early (`θ + 0.25·ω ≥ target`) so the nose doesn't overshoot.

**Gains.** Gravity makes the hold unstable on its own: in the simulated scooter its pole is about 7.6 rad/s (it falls with a time constant of about 0.13 s). One amp of rear current turns into about 16 °/s² of pitch acceleration. So:
- Kp must beat gravity: Kp > 7.6² / 16 ≈ **3.6 A/°**.
- The defaults (Kp 8, Kd 1, Ki 6) give about 8 rad/s and close to critical damping.
- The loop runs at 100 Hz, five or more times faster than that.

**Landing.** The nose follows a target falling at 15°/s, with push from the same PD plus the steady push the hold found. Holding a low nose takes nearly as much push as lifting it, so near the ground it pushes more. A *cushion* allows that, up to a most that only falls (*cushion fades*). The landing is done once the nose is below *down below* and has stopped falling. In the simulation the front lands at under 60°/s.

### Target angle: what's realistic standing up

The target is measured from riding level, with you on the deck. With a 1.1 m wheelbase, 10° puts the front tyre about 19 cm up.

| Target | What it's like |
|---|---|
| 5–8° | Low and easy to hold. The front is clearly up. A good start. |
| **8–15°** | **Where most standing riders end up.** The balance point is still well behind you. |
| 15–20° | Needs a bigger lean back. The balance point is close, so small leans make big speed changes. |
| > 20° | Near the balance point for most standing riders; a small lean back loops it. The cut-out and catch help, but can't save a lean past the balance point. |
| 45° | Not possible standing on a scooter: the balance point is around 25° even upright. The setting tops out at 30°, and the cut-out at 45°, only for unusual builds. |

---

## 2. Set-up on the Spintend Ubox Dual

The Ubox Dual is two controllers on one board, linked by an internal CAN bus. The program runs on **one** of them: the one that reads the throttle. It drives the other over CAN.

1. **Firmware 6.05 or newer on both halves.** Ohmic shows the version for each controller and refuses older firmware.
2. **The IMU must be on the half that reads the throttle.** The program reads the IMU of the controller it runs on. Open More → IMU in Ohmic: the controller that reads the throttle must show live IMU data. If only the other half does, the throttle would need to be on that half. Don't rewire for this without checking with Spintend's documentation first.
3. **Tell Ohmic which wheel that half drives** (Rear or Front, on the Auto-wheelie page). The program then knows which motor holds the wheelie and which one spins the airborne front wheel.
4. **CAN status messages on the other half.** In Tune → App → General, set *CAN Status Messages Mode* to include messages 1 and 4 (1 to 5 is simplest), at 50–100 Hz. The program reads the other motor's speed, current, battery current and temperature from them. If they stop for 50 ms, the wheelie ends safely (reason 16).
5. **A short app timeout on the other half**: about 0.3 s (Tune → App → General → *Timeout*). If the program stops, that motor then lets go quickly too. Its own half lets go within 50 ms whatever this is set to.
6. **Throttle:** ADC, *Current* or *Current No Reverse Brake ADC2* control type, resting at zero (or PPM in a current mode). Ohmic refuses other modes. The ADC ramp-down time sets how long the program waits before handing back the throttle.
7. **Motor limits.** In Ohmic, the kick, most push and landing cushion must fit under the rear motor's *Motor Current Max*, and most braking under its *Motor Current Min*. Ohmic refuses settings that don't fit rather than trimming them. The battery regen limit (*Battery Current Min*) still applies when braking the nose down, which is why a full battery is refused.
8. **IMU rotation settings: set them, calibrate, then leave them.** The program reads the raw gyro and accelerometer and finds its own axes in calibration. If you change the IMU rotation in the controller's settings later, calibrate again.

### Install, calibrate, arm

On the Auto-wheelie page (Features → Auto-wheelie):

1. **Install.** It's installed as the controller's stored script, which needs the whole script space. If another script is there, Ohmic asks first, keeps a copy, and puts it back when you remove the wheelie. The steps are: write → read back and compare → start → check it answers with the right version. Nothing is installed while a wheel turns.
2. **Calibrate** (about a minute):
   - **Flat and empty:** on both wheels, no one touching it. This gives the up direction and the gyro's rest offset.
   - **Front lifted 10–30°** and held still. With the first step, this gives the axis the nose turns around, so any mounting works.
   - **You standing on it:** the deck angle with you on board, which includes rear suspension sag. That angle counts as level.
   - **Check:** lift the front and the angle should rise.

   Each step is checked: about 1 g, no movement, a big enough lift, less than 8° of sag, less than 6° of side lean.
3. **Arm.** It refuses when:
   - the scooter is moving;
   - regen or ABS is on;
   - it isn't calibrated;
   - the battery is above *Battery too full* or below *Battery low*;
   - a setting doesn't fit the motors.

   After sending the settings, Ohmic checks this arming's ID came back and that the loop is running. You feel a rising tone through the deck.
4. **Ride:** roll above *slowest start*, lean back and pin the throttle. A chirp means it started. A short low tone means it said no; the page shows why.

### What survives a power cycle

- **Your settings and calibration** are kept in Ohmic (on the phone), per controller. They're also written into the stored script when you install, and sent again every time you arm, so changing them never needs a reinstall.
- **The program** stays stored on the controller.
- **Armed or not:** it is **never** armed after a power cycle.

### Live checks

While it's armed, the page shows the program's own view at 20 Hz:
- the angle against the target and cut-out;
- the state, and speed;
- rear and front current (negative is braking);
- throttle and loop time.

Before your first real wheelie, check:

- **Angle ≈ 0° rolling on flat ground,** within a degree or so. Lifting the front by hand (parked) makes it rise.
- **Speed matches the dashboard.** If not, the wheel size or motor poles in Tune are wrong, and the speed limits will be too.
- **Loop time about 10 ms.** Above 60 ms in one go, it stops (reason 15).
- **Last stop** explains every end. The reasons are listed in [`wheelie.ts`](../src/onboard/wheelie.ts) (`WHEELIE_REASONS`).

---

## 3. Bench test

Do these with the scooter **strapped on a stand, both wheels off the ground**, nothing near the wheels, and Ohmic open.

| # | Setup | Do | Pass when |
|---|---|---|---|
| 1 | Installed, calibrated, **Dry run** on, *On a stand* off | Arm. Pin the throttle with the wheels stopped. | Rising tone at arm. The pin gets the short low "no" tone and *Too slow* (it needs road speed unless *On a stand* is on). The motors do exactly what your throttle says. |
| 2 | Dry run + **On a stand** (8 A cap) | Pin the throttle. | Chirp. The page shows *Lifting*, then *Holding* if you tip the scooter up by hand, but the motors only ever follow your throttle (dry). |
| 3 | **On a stand**, dry run **off**, stand current 5–8 A | Pin. Then tip the scooter nose-up by hand past the target, and back. | The rear wheel pushes gently (at most the stand current). Below the target it pushes more, above it it brakes (the wheel slows). The page's angle follows your hand. |
| 4 | As 3 | Let go of the throttle. | The tone stops and it goes to *Waiting*. The wheel free-wheels. Below 10 % throttle, after the ramp time, the throttle works normally again. |
| 5 | As 3 | While it's holding and pushing, squeeze the rear brake. Arm again, then try the front brake. | Rear: *A brake was pulled*. Front: *The front brake was pulled*. Both disarm. The rear brake is only noticed while the program asks for more than 10 A, so hold the nose below the target to make it push. |
| 6 | As 3 | Disarm from Ohmic mid-hold. | It lands (the push falls away) and confirms *Disarmed*. |
| 7 | As 3 | Stop the script on the LispBM page mid-hold. | The motors are back under the throttle within 50 ms. |
| 8 | Any | Power-cycle, reconnect. | The page shows *Disarmed*. |

Then on the ground, in an empty car park, with gear and a spotter:

1. **Dry run while rolling.** Pin it to learn the feel of the chirp and the gesture. Nothing happens.
2. **Kick 25–30 A, target 8°, max time 2 s.** Lean back as you pin. If the front doesn't lift (*didn't lift*), lean back more before raising the kick.
3. Raise the kick in 5 A steps until it lifts cleanly. Then the time limit, then the target.

## 4. Tuning

Change one thing at a time, from the defaults, and watch the angle trace.

1. **Kick and kick ramp:** what it takes to lift with your lean. A faster ramp pops the front up sharply.
2. **Hold strength (Kp):** start at 6–8. If the nose sags or drops when you shift your weight, raise it. If it shakes fast, lower it, or raise damping first.
3. **Damping (Kd):** 0.6–1.5. Overshoot at the handover or slow rocking means more. A buzz or hum means less.
4. **Settling (Ki):** how fast the angle comes back to the target after you change your lean. If it sits a degree or two off for a second, raise it. If it rocks slowly (1–2 s per swing), lower it.
5. **Pull-back:** if it overshoots upward more than it sags, raise it.
6. **Most push:** leaning forward needs more push. If the front comes down when you lean forward to speed up (*the front wheel came back down*), raise it within the motor limit.
7. **Landing cushion and fade:** if the front slaps down, raise the cushion. If it hangs in the air after you let go, lower it or make it fade faster.
8. **Brake detection:** if bumps end wheelies, raise it. If a brake pull takes too long to notice, lower it.

## 5. Arming and the trigger

You have no buttons and can't add wires, so the throttle is the trigger. That makes the safeguards below important:

- **Armed from Ohmic, never at power-up, and it disarms itself** after *disarm after* minutes without a wheelie. You can't ride around armed and forget.
- **The pin has to be deliberate:** the throttle comes up from below *ends below* to above *pinned at* within a second, and stays there 0.1 s. A throttle already held open doesn't count. *Two pins within a second* is harder to do by accident.
- **It says no out loud.** A short low tone, and the page shows why: too slow, too fast, battery too full, not level, and so on.
- **Every state change is a tone you feel through the deck:**
  - rising (armed);
  - chirp (started);
  - short high blip (ended normally);
  - long low buzz (safety stop or catching);
  - a tick every 0.6 s (waiting for you to let go).

  Set *tone loudness* to 0 to turn them off. Ohmic refuses a loudness that would push more current through the motor than motor sounds are allowed.

## 6. Safety

- **It can throw you off.** On the rear wheel you're balanced over one contact patch. Leaning back past the balance point can't be caught by any setting: braking the rear wheel can only do so much, and past a point the scooter loops out. If the nose keeps rising, **let go of the throttle and step off the back.**
- **You lean back to lift it.** That's also the direction that ends in a loop-out. Learn small leans first, at a low target.
- **Your Magura brakes aren't wired to the controller.** It notices a brake by the wheels slowing while pushed (rear), or the airborne front wheel stopping. That takes a few hundredths of a second. Braking hard with the front up drops the nose fast. Brake gently, or let go first.
- **A full battery can't absorb braking.** Catching the nose and landing brake the rear motor, and on a full pack that regen has nowhere to go. That's why it won't arm above *battery too full*, and why it judges that by the voltage with little current flowing. Ride a bit first.
- **Gear:** helmet, gloves, wrist guards, knee pads. Empty car park, dry flat ground, nobody near, never in traffic.
- **Start with a dry run and the bench test.** Then a low kick and target, short time limit.
- **Untested on your scooter.** It was designed and tuned against a simulation of a typical 110 kg dual-motor standing scooter and rider. Your weight, stance, wheel size, motors, suspension and tyres are different. Expect the defaults to need tuning, and treat the first rides as tests.
- **If anything looks wrong** (angle reading off, speed wrong, odd tones): disarm and don't ride it. Power-cycling always leaves it disarmed.

## 7. API notes (VESC firmware 6.05)

Every function the program calls was checked against the 6.05 firmware's function list (`lispif`) and LispBM reference. Names that commonly get mixed up:

| You might expect | Real API |
|---|---|
| `get-imu-pitch` | **Doesn't exist.** `(get-imu-rpy)` returns roll, pitch, yaw in radians. The program reads the raw `(get-imu-gyro)` (deg/s) and `(get-imu-acc)` (g) instead, because the firmware's filter is fooled by acceleration. |
| a "release motor" call | `(app-disable-output ms)`: the input app (throttle) stays off the motor for `ms`. `0` gives it back now, `-1` forever. The program renews 50 ms every tick, so control returns by itself if it stops. |
| `set-current` braking with negative amps | Negative `set-current` **reverses**. Braking is `(set-brake amps)` with positive amps, and over CAN `(canset-brake id amps)`. |
| `set-current` alone | `(set-current amps optOffDelay)`: the off-delay keeps the motor switched on while the command crosses zero. The program uses 0.1 s. Same for `(canset-current id amps optOffDelay)`. |
| reading the throttle | `(get-adc-decoded 0)`, 0..1, needs the ADC app running. `(get-ppm)` is -1..1. |
| CAN timing | `(can-msg-age id msg)`: seconds since status message `msg` from `id`, or `nil` if never received. |
| motor tones | `(foc-play-tone channel hz volts)`, `(foc-play-stop)`. FOC only. |
| data to the app | `(send-data list-or-buffer)`, which arrives as `COMM_CUSTOM_APP_DATA`. |
| flash-stored functions | `@const-start` / `@const-end` in a stored script (6.05+), with `@const-symbol-strings`. They only work in the stored script, not typed in the console. The program needs them: its functions live in flash, and only its values stay in the 2,464-cell script memory. |
| console limits | The LispBM console drops a command sent within 0.5 s of the last one, and a line is limited in length. Ohmic keeps a 0.65 s gap and packs settings into lines of up to 440 characters. |

Other names it uses, all in 6.05:
- motors and battery: `get-rpm`, `canget-rpm`, `get-current`, `canget-current`, `get-current-in`, `canget-current-in`, `get-vin`, `get-fault`;
- temperatures: `get-temp-fet`, `canget-temp-fet`, `get-temp-mot`, `canget-temp-motor`;
- time and threads: `systime`, `secs-since`, `spawn`, `loopwhile`, `sleep`;
- maths: `atan`, `atan2`, `sqrt`, `rad2deg`, `abs`, `to-i`;
- buffers: `bufcreate`, `bufset-u8`, `bufset-i16`, `bufset-f32`.

Built on the open VESC project ([vesc-project.com](https://vesc-project.com)) and LispBM.
