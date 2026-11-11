;; =============================================================================
;;  Auto-wheelie for a standing electric scooter
;;  VESC firmware 6.05 or newer. Part of Ohmic, an independent app built on the
;;  open VESC project (vesc-project.com).
;; =============================================================================
;;
;; WHAT IT DOES
;;   Arm it while parked. Then, rolling between the minimum and maximum speed,
;;   pin the throttle: the motors kick the front wheel up and the rear motor
;;   holds it at the target angle. Lean forward and it pushes harder to keep the
;;   nose up, so you speed up; lean back and it eases off, then brakes, so you
;;   slow down. Let go of the throttle and it lands.
;;
;; HOW IT STAYS SAFE
;;   - Letting go of the throttle always ends it. After landing, both motors
;;     free-wheel until the throttle is let go, so a pinned throttle can't drive
;;     on its own the moment control goes back.
;;   - It only borrows the motors 50 ms at a time (app-disable-output): if this
;;     program stops for any reason, the throttle has them back within 50 ms.
;;   - Above the cut-out angle it brakes the rear wheel to bring the nose down.
;;   - It ends the wheelie when: the time runs out, you go too fast or too slow,
;;     the scooter leans or turns hard, a brake is pulled (seen as a wheel
;;     slowing while its motor pushes), the rear wheel spins, the battery is low,
;;     the current stays too high, or anything gets too hot.
;;   - A stalled IMU, a late loop, the other controller going quiet on CAN, or a
;;     controller fault stops it and leaves the motors free-wheeling.
;;   - It does nothing at power-up but wait, disarmed. It's armed from Ohmic,
;;     or by typing (wl-start) in the LispBM console, and disarms itself after
;;     wl-arm-minutes without a wheelie.
;;   - While landing the push only falls away, never grows.
;;
;; WHERE THE ANGLE COMES FROM
;;   The firmware's own pitch (get-imu-rpy) is fooled by hard acceleration, which
;;   is exactly when a wheelie starts. So this program keeps its own: the gyro,
;;   turned into degrees, and, only while the front wheel is down and the
;;   scooter isn't being shaken, a slow pull toward the angle gravity shows,
;;   after taking out what the wheel's own speeding up adds. Up on the rear
;;   wheel it's gyro only. The CALIBRATION block says which way the IMU points,
;;   so it works however the controller is mounted: leave the IMU rotation
;;   settings in the controller's configuration alone after calibrating.
;;
;; INSTALLING
;;   Ohmic installs this as the controller's stored script (replacing any other
;;   one) with your settings filled in. To do it by hand: fill in SETTINGS,
;;   CALIBRATION and WIRING, upload it from VESC Tool's LispBM page and run it.
;;   The functions are kept in flash (@const-start), because the controller's
;;   script memory is too small to hold them.

@const-symbol-strings

;; ----------------------------------------------------------------- SETTINGS --
;; Ohmic sends these again each time it arms, so changing them needs no
;; reinstall.
;; @settings
(def wl-target 10.0)      ; deg    front-up angle to hold, from riding level
(def wl-kp 8.0)           ; A/deg  push per degree below the target
(def wl-ki 6.0)           ; A/(deg s)  slowly builds the push a steady hold needs
(def wl-kd 1.0)           ; A/(deg/s)  damping: eases off while the nose rises
(def wl-catch-gain 1.5)   ; x      stronger pull-back when above the target
(def wl-kick 50.0)        ; A      push that lifts the front wheel
(def wl-kick-ramp 250.0)  ; A/s    how fast the kick builds
(def wl-hold-max 60.0)    ; A      most push while holding
(def wl-catch-max 45.0)   ; A      most braking, to bring the nose down
(def wl-front-share 1.0)  ; 0..1   front motor's share of the kick, before lift-off
(def wl-front-sync 6.0)   ; A      keeps the airborne front wheel at road speed
(def wl-max-angle 20.0)   ; deg    above this, brake to bring the nose down
(def wl-min-kmh 10.0)     ; km/h   slowest a wheelie starts (ends 3 km/h below)
(def wl-max-kmh 30.0)     ; km/h   fastest a wheelie starts or goes on
(def wl-max-time 4.0)     ; s      longest wheelie
(def wl-min-volts 40.0)   ; V      battery too low below this
(def wl-max-volts 53.0)   ; V      battery too full to brake hard above this
(def wl-max-amps-in 100.0); A      battery current (both controllers) for 0.3 s
(def wl-max-fet-c 75.0)   ; C      controller temperature
(def wl-max-motor-c 100.0); C      motor temperature
(def wl-max-roll 12.0)    ; deg    lean to the side
(def wl-max-yaw 40.0)     ; deg/s  turning rate
(def wl-brake-decel 3.0)  ; m/s2   rear wheel slowing this fast while pushed = brake
(def wl-trigger 0)        ; 0: pin the throttle   1: pin it twice within a second
(def wl-pin 0.95)         ; 0..1   throttle counted as pinned
(def wl-let-go 0.7)       ; 0..1   throttle below this ends the wheelie
;; After an ordinary end (you let go, or the time ran out) the landing may use up
;; to this much push to set the front wheel down gently; the most it may use
;; only falls, at the landing ramp. Other ends never push more than they were.
(def wl-land-cushion 40.0); A      most push used to soften an ordinary landing
(def wl-land-ramp 20.0)   ; A/s    how fast that most falls away
(def wl-land-angle 1.5)   ; deg    the front wheel counts as down below this
(def wl-arm-minutes 10.0) ; min    disarms itself after this long without a wheelie
(def wl-tone-volts 1.5)   ; V      motor tones you feel through the deck (0: off)
(def wl-dry 0)            ; 1: do everything but drive the motors (tones still play)
(def wl-bench 0)          ; 1: on a stand: any speed, currents capped
(def wl-bench-amps 8.0)   ; A      the cap on a stand
;; @end

;; -------------------------------------------------------------- CALIBRATION --
;; Directions in the IMU's own axes (x y z), from Ohmic's calibration:
;; forward along the deck, up out of the deck, and the axis the nose turns up
;; around (forward x up). Then the gyro's resting offset (deg/s) and the deck's
;; angle (deg) with you standing on it on flat ground.
;; @calibration
(def wl-fx 1.0) (def wl-fy 0.0) (def wl-fz 0.0)
(def wl-ux 0.0) (def wl-uy 0.0) (def wl-uz 1.0)
(def wl-sx 0.0) (def wl-sy -1.0) (def wl-sz 0.0)
(def wl-gbx 0.0) (def wl-gby 0.0) (def wl-gbz 0.0)
(def wl-zero 0.0)
;; @end

;; ------------------------------------------------------------------- WIRING --
;; @wiring
(def wl-rear -1)          ; -1: the rear motor is on this controller, else its CAN ID
(def wl-front 1)          ; -1: this controller, -2: no front motor, else its CAN ID
(def wl-input 0)          ; throttle: 0 ADC app, 1 PPM
(def wl-spe 0.000898)     ; m/s per ERPM (wheel size, motor poles, gearing)
(def wl-handback-wait 0.5); s     the ADC app's ramp-down time, plus a margin
;; @end

;; What Ohmic reads before arming: which version this is, and that it's idle.
(def wl-version 1)
(def wl-run 0)            ; which arming this is (Ohmic checks it took)
(def wl-on 0) (def wl-state 0) (def wl-reason 0) (def wl-count 0) (def wl-beat 0)
(def wl-stop 0) (def wl-tele 0) (def wl-loop-dt 0.0) (def wl-cal-out 0) (def wl-vrest 0.0)

@const-start

;; ------------------------------------------------------------------ HELPERS --

(defun wl-clamp (x lo hi) (if (< x lo) lo (if (> x hi) hi x)))

(defun wl-max (a b) (if (> a b) a b))

;; Moves x toward goal by at most step.
(defun wl-toward (x goal step)
  (if (> goal (+ x step)) (+ x step) (if (< goal (- x step)) (- x step) goal)))

;; Smooths x toward goal over about tc seconds.
(defun wl-ease (x goal dt tc) (+ x (* (- goal x) (wl-clamp (/ dt tc) 0.0 1.0))))

;; A tone through the motor, felt through the deck.
(defun wl-tone (hz secs)
  (if (> wl-tone-volts 0.0) (progn (foc-play-tone 0 hz wl-tone-volts) (def wl-tone-t secs)) nil))

;; States: 0 off, 1 armed, 2 lifting, 3 holding, 4 catching (braking the nose
;; down), 5 landing, 6 free-wheeling until the throttle is let go, 7 stopped by
;; a fault.
(defun wl-go (s) (progn (def wl-state s) (def wl-st 0.0)))

(defun wl-in-control () (and (> wl-state 1) (< wl-state 7)))

;; Front wheel on the ground (as far as this program is concerned).
(defun wl-grounded () (or (< wl-state 2) (> wl-state 5)))

;; -------------------------------------------------------------------- SENSE --

;; Gyro (deg/s, resting offset removed) and accelerometer (g), in the IMU's axes.
(defun wl-read-imu ()
  (let ((g (get-imu-gyro)) (a (get-imu-acc)))
    (progn
      (def wl-gx (- (ix g 0) wl-gbx)) (def wl-gy (- (ix g 1) wl-gby)) (def wl-gz (- (ix g 2) wl-gbz))
      (def wl-ax (ix a 0)) (def wl-ay (ix a 1)) (def wl-az (ix a 2)))))

;; Readings that stop changing, or a gravity reading far from 1 g, mean the IMU
;; isn't working.
(defun wl-check-imu ()
  (let ((sum (+ wl-gx (* 2.0 wl-gy) (* 3.0 wl-gz) (* 5.0 wl-ax) (* 7.0 wl-ay) (* 11.0 wl-az))))
    (progn
      (def wl-gmag (sqrt (+ (* wl-ax wl-ax) (* wl-ay wl-ay) (* wl-az wl-az))))
      (def wl-imu-bad (if (or (= sum wl-imu-sum) (< wl-gmag 0.2) (> wl-gmag 6.0)) (+ wl-imu-bad 1) 0))
      (def wl-imu-sum sum))))

(defun wl-rpm (id) (if (< id 0) (get-rpm) (canget-rpm id)))

(defun wl-amps (id) (if (< id 0) (get-current) (canget-current id)))

;; Throttle 0..1, wheel speeds (m/s), battery voltage, controller fault.
(defun wl-read-ride ()
  (progn
    (def wl-thr (if (= wl-input 0) (get-adc-decoded 0) (wl-clamp (get-ppm) 0.0 1.0)))
    (def wl-vr (* wl-spe (wl-rpm wl-rear)))
    (def wl-vf (if (= wl-front -2) wl-vr (* wl-spe (wl-rpm wl-front))))
    (def wl-vin (get-vin))
    (def wl-fault-code (get-fault))))

;; Battery current and temperatures of both controllers.
(defun wl-read-power (dt)
  (let ((c wl-can))
    (progn
      (def wl-amps-in (+ (get-current-in) (if (< c 0) 0.0 (canget-current-in c))))
      (def wl-over-t (if (> wl-amps-in wl-max-amps-in) (+ wl-over-t dt) 0.0))
      ;; Full throttle pulls the voltage down, so how full the battery is shows
      ;; when little current flows: the last such reading stands until the next.
      (if (< (abs wl-amps-in) 5.0) (def wl-vrest wl-vin) nil)
      (def wl-fet (if (< c 0) (get-temp-fet) (wl-max (get-temp-fet) (canget-temp-fet c))))
      (def wl-mot (if (< c 0) (get-temp-mot) (wl-max (get-temp-mot) (canget-temp-motor c)))))))

;; Whether the other controller is still reporting over CAN.
(defun wl-check-can ()
  (if (< wl-can 0) (def wl-can-bad 0)
    (let ((age (can-msg-age wl-can 1)))
      (def wl-can-bad (if (or (eq age nil) (> age 0.1)) (+ wl-can-bad 1) 0)))))

;; ----------------------------------------------------------------- ESTIMATE --

;; The rear wheel's acceleration (m/s2), and what the accelerometer reads along
;; the scooter's forward, up and side axes (g), all smoothed the same way (over
;; about 50 ms): then taking one from the other leaves only gravity, even while
;; the push changes quickly.
(defun wl-smooth (dt)
  (progn
    (def wl-acc (wl-ease wl-acc (/ (- wl-vr wl-vr-last) dt) dt 0.05))
    (def wl-vr-last wl-vr)
    (def wl-af (wl-ease wl-af (+ (* wl-fx wl-ax) (* wl-fy wl-ay) (* wl-fz wl-az)) dt 0.05))
    (def wl-au (wl-ease wl-au (+ (* wl-ux wl-ax) (* wl-uy wl-ay) (* wl-uz wl-az)) dt 0.05))
    (def wl-as (wl-ease wl-as (+ (* wl-sx wl-ax) (* wl-sy wl-ay) (* wl-sz wl-az)) dt 0.05))))

;; Pitch (deg, nose up) and roll (deg) from the gyro; the pitch rate (smoothed
;; over 20 ms, for damping) and the turn rate.
(defun wl-estimate (dt)
  (let ((rate (+ (* wl-sx wl-gx) (* wl-sy wl-gy) (* wl-sz wl-gz)))
        (rollr (+ (* wl-fx wl-gx) (* wl-fy wl-gy) (* wl-fz wl-gz))))
    (progn
      (def wl-pitch (+ wl-pitch (* rate dt)))
      (def wl-roll (+ wl-roll (* rollr dt)))
      (def wl-rate (wl-ease wl-rate rate dt 0.02))
      (def wl-yaw (wl-ease wl-yaw (+ (* wl-ux wl-gx) (* wl-uy wl-gy) (* wl-uz wl-gz)) dt 0.05))
      (if (wl-grounded) (wl-level dt) nil))))

;; Front wheel down and the accelerometer reading close to 1 g: pull pitch and
;; roll toward what gravity shows, over about 0.4 s.
(defun wl-level (dt)
  (if (< (abs (- (sqrt (+ (* wl-af wl-af) (* wl-au wl-au) (* wl-as wl-as))) 1.0)) 0.15)
    (progn
      (def wl-pitch (wl-ease wl-pitch (wl-grav-pitch) dt 0.4))
      (def wl-roll (wl-ease wl-roll (rad2deg (atan2 (- 0.0 wl-as) wl-au)) dt 0.4)))
    nil))

;; The pitch gravity shows, less the tilt the wheel's own acceleration adds,
;; and less the deck's angle with you standing on it.
(defun wl-grav-pitch ()
  (- (rad2deg (atan2 wl-af wl-au)) (rad2deg (atan (/ wl-acc 9.81))) wl-zero))

;; ------------------------------------------------------------------- CHECKS --

;; The first reason a wheelie can't go on (or start), or 0.
(defun wl-problem ()
  (cond
    ((> wl-imu-bad 3) 14)
    ((> wl-can-bad 5) 16)
    ((> wl-fault-code 0) 21)
    ((< wl-vin wl-min-volts) 10)
    ((> wl-over-t 0.3) 11)
    ((> wl-fet wl-max-fet-c) 12)
    ((> wl-mot wl-max-motor-c) 13)
    ((> (abs wl-roll) wl-max-roll) 6)
    ((> (abs wl-yaw) wl-max-yaw) 7)
    (t 0)))

;; Why a wheelie can't start right now, or 0.
(defun wl-start-problem ()
  (let ((p (wl-problem)) (kmh (* 3.6 wl-vr)))
    (cond
      ((> p 0) p)
      ((and (= wl-bench 0) (< kmh wl-min-kmh)) 4)
      ((and (= wl-bench 0) (> kmh wl-max-kmh)) 3)
      ((> (wl-max wl-vin wl-vrest) wl-max-volts) 22)
      ((> (abs wl-pitch) 4.0) 23)
      (t 0))))

;; A brake pulled while a motor pushes: the rear wheel slows although its motor
;; drives it, or the airborne front wheel falls behind although its motor spins
;; it at road speed. And the rear wheel spinning: it speeds up faster than the
;; scooter ever could.
(defun wl-brakes (dt)
  (progn
    (def wl-brake-t (if (and (> wl-out 10.0) (< wl-acc (- 0.0 wl-brake-decel))) (+ wl-brake-t dt) 0.0))
    (def wl-fbrake-t (if (and (> wl-front -2) (> wl-pitch 3.0) (> wl-vr 2.0) (> wl-took 0.5) (< wl-vf (* 0.75 wl-vr))) (+ wl-fbrake-t dt) 0.0))
    (def wl-slip-t (if (> wl-acc 12.0) (+ wl-slip-t dt) 0.0))))

;; Why the wheelie must end now, or 0. Letting go of the throttle comes first.
(defun wl-end-why ()
  (let ((p (wl-problem)))
    (cond
      ((= wl-stop 1) 19)
      ((< wl-thr wl-let-go) 1)
      ((> p 0) p)
      ((> wl-brake-t 0.06) 8)
      ((> wl-fbrake-t 0.15) 9)
      ((> wl-slip-t 0.05) 18)
      ((and (= wl-bench 0) (> (* 3.6 wl-vr) wl-max-kmh)) 3)
      (t 0))))

;; After a wheelie ends for this reason: 1 stays armed (an ordinary end),
;; 7 stopped by a fault, 0 switched off (a safety stop: arm again to go on).
(defun wl-after-for (r)
  (cond
    ((or (= r 1) (= r 2) (= r 3) (= r 4) (= r 17) (= r 24)) 1)
    ((or (= r 14) (= r 15) (= r 16) (= r 21)) 7)
    (t 0)))

;; ------------------------------------------------------------------ TRIGGER --

;; True the moment the throttle gesture completes: pinned for 0.1 s, having
;; come up from below the let-go level within a second. With the double-pump
;; trigger, the second such pin within a second of the first.
(defun wl-pinned (dt)
  (let ((was wl-pin-t))
    (progn
      (def wl-low-t (if (< wl-thr wl-let-go) 0.0 (+ wl-low-t dt)))
      (def wl-pin-t (if (>= wl-thr wl-pin) (+ wl-pin-t dt) 0.0))
      (def wl-pin1-t (+ wl-pin1-t dt))
      (if (and (>= wl-pin-t 0.1) (< was 0.1) (< (- wl-low-t wl-pin-t) 1.0)) (wl-pin-edge) nil))))

(defun wl-pin-edge ()
  (if (or (= wl-trigger 0) (< wl-pin1-t 1.0))
    (progn (def wl-pin1-t 99.0) t)
    (progn (def wl-pin1-t 0.0) nil)))

;; ------------------------------------------------------------------- STATES --

(defun wl-armed (dt)
  (progn
    (def wl-armed-t (+ wl-armed-t dt))
    (cond
      ((= wl-stop 1) (wl-go 0))
      ((> wl-armed-t (* 60.0 wl-arm-minutes)) (progn (def wl-reason 20) (wl-tone 700 0.4) (def wl-stop 1) (wl-go 0)))
      ((wl-pinned dt) (wl-try))
      (t nil))))

;; The gesture came: start, or say no with a short low tone (and why, for Ohmic).
(defun wl-try ()
  (let ((why (wl-start-problem)))
    (if (> why 0) (progn (def wl-reason why) (wl-tone 600 0.15)) (wl-engage))))

(defun wl-engage ()
  (progn
    (def wl-count (+ wl-count 1)) (def wl-reason 0) (def wl-took 0.0) (def wl-roll 0.0)
    (def wl-out (wl-clamp (wl-amps wl-rear) 0.0 wl-kick)) (def wl-outf 0.0) (def wl-i 0.0)
    (def wl-brake-t 0.0) (def wl-fbrake-t 0.0) (def wl-slip-t 0.0)
    (wl-tone 2200 0.1)
    (wl-go 2)))

;; Keeps the airborne front wheel near road speed so it lands without a jolt;
;; not after the front brake ended it (the rider wants that wheel slowed).
(defun wl-sync () (if (= wl-reason 9) 0.0 (wl-clamp (* 4.0 (- wl-vr wl-vf)) (- 0.0 wl-front-sync) wl-front-sync)))

;; Lifting: build the kick (both motors while the front is down), and hand
;; over to holding just before the target, so it doesn't overshoot. On a stand
;; there's longer to tip it up by hand.
(defun wl-lift (dt)
  (let ((why (wl-end-why)))
    (progn
      (wl-brakes dt)
      (def wl-out (wl-toward wl-out wl-kick (* wl-kick-ramp dt)))
      (def wl-outf (if (< wl-pitch 1.5) (* wl-front-share wl-out) (wl-sync)))
      (cond
        ((> why 0) (wl-end why))
        ((> wl-pitch wl-max-angle) (wl-catch-start))
        ((>= (+ wl-pitch (* 0.25 wl-rate)) wl-target) (wl-hold-start))
        ((and (> wl-st (if (= wl-bench 1) 8.0 1.2)) (< wl-pitch 1.5)) (wl-end 17))
        (t nil)))))

;; Push from the angle error and its rate. Above the target the pull-back is stronger.
(defun wl-pd ()
  (let ((e (- wl-target wl-pitch)))
    (- (* wl-kp e (if (< e 0.0) wl-catch-gain 1.0)) (* wl-kd wl-rate))))

;; Starts holding with a steady push between nothing and what the kick reached,
;; or what the last wheelie settled on if that's more: the kick is more than a
;; rider leaning back needs (starting from it carries the nose past the target),
;; and nothing is far less than a rider leaning forward needs.
(defun wl-hold-start ()
  (progn
    (def wl-i (wl-clamp (wl-max wl-i-last (* 0.5 (- wl-out (wl-pd)))) 0.0 wl-hold-max))
    (wl-go 3)))

(defun wl-hold (dt)
  (let ((why (wl-end-why)))
    (progn
      (wl-brakes dt)
      (wl-hold-out dt)
      (cond
        ((> why 0) (wl-end why))
        ((> wl-pitch wl-max-angle) (wl-catch-start))
        ((> wl-took wl-max-time) (wl-end 2))
        ((and (= wl-bench 0) (< (* 3.6 wl-vr) (- wl-min-kmh 3.0))) (wl-end 4))
        ((and (< wl-pitch 1.0) (> wl-st 0.3) (= wl-bench 0)) (wl-end 24))
        (t nil)))))

;; PD plus the slowly built push, inside the limits, changing at most 800 A/s.
(defun wl-hold-out (dt)
  (let ((lo (- 0.0 wl-catch-max)))
    (progn
      (def wl-i (wl-clamp (+ wl-i (* wl-ki (- wl-target wl-pitch) dt)) lo wl-hold-max))
      (def wl-out (wl-toward wl-out (wl-clamp (+ (wl-pd) wl-i) lo wl-hold-max) (* 800.0 dt)))
      (def wl-outf (wl-sync)))))

;; Past the cut-out angle: brake the rear wheel to bring the nose down.
(defun wl-catch-start () (progn (def wl-reason 5) (wl-tone 400 0.6) (wl-go 4)))

(defun wl-catch (dt)
  (progn
    (def wl-out (wl-toward wl-out (- 0.0 wl-catch-max) (* 2000.0 dt)))
    (def wl-outf (wl-sync))
    (cond
      ((< (* 3.6 wl-vr) 3.0) (wl-coast-start))
      ((< wl-pitch (- wl-max-angle 3.0)) (wl-land-start))
      ((> wl-st 1.5) (wl-land-start))
      (t nil))))

;; Ends the wheelie: land it, or after a fault go straight to free-wheeling.
(defun wl-end (why)
  (progn
    (def wl-reason why)
    (if (= (wl-after-for why) 1) (wl-tone 1000 0.12) (wl-tone 400 0.6))
    (if (= (wl-after-for why) 7) (wl-coast-start) (wl-land-start))))

(defun wl-land-start ()
  (progn
    (def wl-land-base (if (= wl-state 3) wl-i 0.0))
    (def wl-still-t 0.0)
    (if (= wl-state 3) (def wl-i-last wl-i) nil)
    (def wl-cap (wl-max wl-out (if (= (wl-after-for wl-reason) 1) wl-land-cushion 0.0)))
    (def wl-land-p wl-pitch)
    (wl-go 5)))

;; Landing: the nose follows a target that falls 15 deg/s, on top of the steady
;; push (or braking, for a rider leaning far back) the hold had found. Too high
;; and it eases off or brakes; dropping too fast and it pushes, up to a most that
;; only falls. It's down once the nose is low and has stopped falling (the front
;; tyre is on the road), or has been still for 0.2 s after the target reached
;; the ground.
(defun wl-land (dt)
  (progn
    (def wl-cap (wl-max (- wl-cap (* wl-land-ramp dt)) 0.0))
    (def wl-land-p (wl-max (- wl-land-p (* 15.0 dt)) 0.0))
    (def wl-out (wl-clamp (+ wl-land-base (* wl-kp (- wl-land-p wl-pitch)) (* -1.0 wl-kd wl-rate)) (- 0.0 wl-catch-max) wl-cap))
    (def wl-outf (wl-sync))
    (def wl-still-t (if (and (= wl-land-p 0.0) (< (abs wl-rate) 3.0)) (+ wl-still-t dt) 0.0))
    (cond
      ((> wl-pitch wl-max-angle) (wl-catch-start))
      ((or (and (< wl-pitch wl-land-angle) (> wl-rate -3.0)) (< wl-pitch 0.3) (> wl-still-t 0.2)) (wl-coast-start))
      ((or (< (* 3.6 wl-vr) 3.0) (> wl-st 3.0)) (wl-coast-start))
      (t nil))))

(defun wl-coast-start () (progn (def wl-after (wl-after-for wl-reason)) (wl-go 6)))

;; Down: both motors free-wheel until the throttle is let go (with a tone every
;; 0.6 s as a reminder), then the throttle has the motors again.
(defun wl-coast (dt)
  (progn
    (def wl-out (wl-toward wl-out 0.0 (* 600.0 dt)))
    (def wl-outf 0.0)
    (if (and (< wl-thr 0.1) (= wl-out 0.0) (> wl-st wl-handback-wait))
      (wl-handback)
      (if (> wl-st 1.0) (wl-remind dt) nil))))

(defun wl-remind (dt)
  (progn
    (def wl-remind-t (+ wl-remind-t dt))
    (if (> wl-remind-t 0.6) (progn (def wl-remind-t 0.0) (wl-tone 800 0.1)) nil)))

(defun wl-handback ()
  (progn
    (if (= wl-dry 0) (wl-release) nil)
    (wl-go wl-after)
    (if (= wl-after 1) (def wl-armed-t 0.0) (def wl-stop 1))))

(defun wl-release ()
  (progn
    (wl-drive wl-rear 0.0)
    (if (> wl-front -2) (wl-drive wl-front 0.0) nil)
    (app-disable-output 0)))

;; A fault: mid-wheelie, straight to free-wheeling; armed, stop.
(defun wl-fail (why)
  (cond
    ((and (wl-in-control) (< wl-state 6)) (progn (def wl-reason why) (wl-tone 400 0.6) (wl-coast-start)))
    ((= wl-state 1) (progn (def wl-reason why) (wl-tone 400 0.6) (def wl-stop 1) (wl-go 7)))
    (t nil)))

(defun wl-step (dt)
  (progn
    (def wl-st (+ wl-st dt))
    (cond
      ((= wl-state 1) (wl-armed dt))
      ((= wl-state 2) (wl-lift dt))
      ((= wl-state 3) (wl-hold dt))
      ((= wl-state 4) (wl-catch dt))
      ((= wl-state 5) (wl-land dt))
      ((= wl-state 6) (wl-coast dt))
      (t nil))))

;; ------------------------------------------------------------------- OUTPUT --

;; Push (amps >= 0) or brake (amps < 0, never reverses) on this controller (id
;; -1) or another over CAN. The off-delay keeps the motor switched on while
;; the push crosses zero, so control stays smooth.
(defun wl-drive (id amps)
  (if (< id 0)
    (if (< amps 0.0) (set-brake (- 0.0 amps)) (set-current amps 0.1))
    (if (< amps 0.0) (canset-brake id (- 0.0 amps)) (canset-current id amps 0.1))))

(defun wl-bench-cap (a) (if (= wl-bench 1) (wl-clamp a (- 0.0 wl-bench-amps) wl-bench-amps) a))

;; While in control (and not a dry run): keep the throttle off the motors for
;; the next 50 ms and set both motors.
(defun wl-apply ()
  (if (and (wl-in-control) (= wl-dry 0))
    (progn
      (app-disable-output 50)
      (wl-drive wl-rear (wl-bench-cap wl-out))
      (if (> wl-front -2) (wl-drive wl-front (wl-bench-cap wl-outf)) nil))
    nil))

(defun wl-sounds (dt)
  (if (> wl-tone-t 0.0)
    (progn (def wl-tone-t (- wl-tone-t dt)) (if (<= wl-tone-t 0.0) (foc-play-stop) nil))
    nil))

;; 20 times a second while Ohmic asks for it: what the program sees and does,
;; as custom app data ("WL", version, state, reason, flags, count, then floats).
(defun wl-send ()
  (progn
    (def wl-tk (+ wl-tk 1))
    (if (and (> wl-tele 0) (> wl-tk 4)) (progn (def wl-tk 0) (def wl-tele (- wl-tele 1)) (send-data (wl-pack))) nil)))

(defun wl-pack ()
  (progn
    (bufset-u8 wl-buf 0 87) (bufset-u8 wl-buf 1 76) (bufset-u8 wl-buf 2 wl-version)
    (bufset-u8 wl-buf 3 wl-state) (bufset-u8 wl-buf 4 wl-reason) (bufset-u8 wl-buf 5 (+ wl-dry (* 2 wl-bench)))
    (bufset-i16 wl-buf 6 wl-count)
    (bufset-f32 wl-buf 8 wl-pitch) (bufset-f32 wl-buf 12 wl-rate) (bufset-f32 wl-buf 16 wl-roll)
    (wl-pack2)))

(defun wl-pack2 ()
  (progn
    (bufset-f32 wl-buf 20 wl-yaw) (bufset-f32 wl-buf 24 wl-out) (bufset-f32 wl-buf 28 wl-outf)
    (bufset-f32 wl-buf 32 wl-vr) (bufset-f32 wl-buf 36 wl-thr) (bufset-f32 wl-buf 40 wl-took)
    (bufset-f32 wl-buf 44 wl-loop-dt)
    wl-buf))

;; --------------------------------------------------------------------- LOOP --

;; One run of the loop, up to 100 times a second. Returns nil when it's time to stop.
(defun wl-tick ()
  (let ((raw (secs-since wl-t)))
    (let ((dt (wl-clamp raw 0.001 0.1)))
      (progn
        (def wl-t (systime))
        (def wl-loop-dt (wl-ease wl-loop-dt raw dt 0.5))
        (wl-read-imu) (wl-check-imu) (wl-read-ride) (wl-read-power dt) (wl-check-can)
        (wl-smooth dt) (wl-estimate dt)
        (if (wl-in-control) (def wl-took (+ wl-took dt)) nil)
        (wl-faults raw)
        (wl-step dt) (wl-apply) (wl-sounds dt) (wl-send)
        (def wl-beat (if (> wl-beat 99999) 0 (+ wl-beat 1)))
        (wl-keep-going)))))

;; A loop that ran late, a stalled IMU or the other controller gone quiet.
(defun wl-faults (raw)
  (cond
    ((> raw 0.06) (wl-fail 15))
    ((> wl-imu-bad 3) (wl-fail 14))
    ((> wl-can-bad 5) (wl-fail 16))
    (t nil)))

(defun wl-keep-going ()
  (if (and (= wl-stop 1) (not (wl-in-control))) (progn (def wl-on 0) nil) t))

(defun wl-reset ()
  (progn
    (def wl-st 0.0) (def wl-armed-t 0.0) (def wl-took 0.0) (def wl-tone-t 0.0) (def wl-remind-t 0.0)
    (def wl-pitch 0.0) (def wl-rate 0.0) (def wl-roll 0.0) (def wl-yaw 0.0) (def wl-acc 0.0)
    (def wl-af 0.0) (def wl-au 1.0) (def wl-as 0.0)
    (def wl-out 0.0) (def wl-outf 0.0) (def wl-i 0.0) (def wl-i-last 0.0) (def wl-land-base 0.0) (def wl-still-t 0.0) (def wl-cap 0.0) (def wl-land-p 0.0)
    (def wl-low-t 0.0) (def wl-pin-t 0.0) (def wl-pin1-t 99.0) (def wl-over-t 0.0) (def wl-loop-dt 0.01) (def wl-vrest (get-vin))))

(defun wl-reset2 ()
  (progn
    (def wl-brake-t 0.0) (def wl-fbrake-t 0.0) (def wl-slip-t 0.0) (def wl-gmag 1.0)
    (def wl-imu-bad 0) (def wl-imu-sum 0.0) (def wl-can-bad 0) (def wl-tk 0)
    (def wl-reason 0) (def wl-after 1) (def wl-count 0) (def wl-beat 0) (def wl-stop 0)
    (def wl-buf (bufcreate 48))
    (def wl-can (if (>= wl-rear 0) wl-rear (if (>= wl-front 0) wl-front -1)))))

;; Arms it: starts the loop in its own thread, with a rising tone. Does nothing
;; if it's already running.
(defun wl-start ()
  (if (= wl-on 1) nil
    (progn
      (wl-reset) (wl-reset2)
      (wl-read-ride) (def wl-vr-last wl-vr)
      (def wl-t (systime)) (def wl-on 1) (wl-go 1)
      (wl-tone 1500 0.25)
      (spawn "wheelie" 400 (lambda () (loopwhile (wl-tick) (sleep 0.01))))
      t)))

;; Disarms it. Mid-wheelie, it lands first.
(defun wl-off () (progn (def wl-stop 1) t))

;; ---------------------------------------------------------------- CALIBRATE --

;; Averages the IMU over about a second, in its own thread. Leaves the result
;; in wl-cal-out as whole numbers (x 10000): acc x y z (g), gyro x y z (deg/s),
;; then how far gravity's size moved (g), to check the scooter was still.
(defun wl-cal ()
  (if (= wl-on 1) nil
    (progn
      (def wl-cal-out 0) (def wl-cn 0) (def wl-cax 0.0) (def wl-cay 0.0) (def wl-caz 0.0)
      (def wl-cgx 0.0) (def wl-cgy 0.0) (def wl-cgz 0.0) (def wl-clo 9.0) (def wl-chi 0.0)
      (spawn "wl-cal" 200 (lambda () (loopwhile (wl-cal-add) (sleep 0.01))))
      t)))

;; Adds one reading; after the 100th, leaves the result and returns nil to stop.
(defun wl-cal-add ()
  (let ((a (get-imu-acc)) (g (get-imu-gyro)))
    (let ((m (sqrt (+ (* (ix a 0) (ix a 0)) (* (ix a 1) (ix a 1)) (* (ix a 2) (ix a 2))))))
      (progn
        (def wl-cn (+ wl-cn 1))
        (def wl-cax (+ wl-cax (ix a 0))) (def wl-cay (+ wl-cay (ix a 1))) (def wl-caz (+ wl-caz (ix a 2)))
        (def wl-cgx (+ wl-cgx (ix g 0))) (def wl-cgy (+ wl-cgy (ix g 1))) (def wl-cgz (+ wl-cgz (ix g 2)))
        (def wl-clo (if (< m wl-clo) m wl-clo)) (def wl-chi (if (> m wl-chi) m wl-chi))
        (if (< wl-cn 100) t (wl-cal-done))))))

(defun wl-cal-done ()
  (progn
    (def wl-cal-out (list (wl-c4 wl-cax) (wl-c4 wl-cay) (wl-c4 wl-caz) (wl-c4 wl-cgx) (wl-c4 wl-cgy) (wl-c4 wl-cgz) (wl-c4 (* 100.0 (- wl-chi wl-clo)))))
    nil))

;; The sum of 100 readings, as their average x 10000.
(defun wl-c4 (sum) (to-i (* 100.0 sum)))

;; The pitch and roll gravity shows right now (deg x 10), through the
;; calibration, for checking it: lift the front and the first number rises.
(defun wl-peek ()
  (let ((a (get-imu-acc)))
    (let ((af (+ (* wl-fx (ix a 0)) (* wl-fy (ix a 1)) (* wl-fz (ix a 2))))
          (au (+ (* wl-ux (ix a 0)) (* wl-uy (ix a 1)) (* wl-uz (ix a 2))))
          (as (+ (* wl-sx (ix a 0)) (* wl-sy (ix a 1)) (* wl-sz (ix a 2)))))
      (list (to-i (* 10.0 (- (rad2deg (atan2 af au)) wl-zero))) (to-i (* 10.0 (rad2deg (atan2 (- 0.0 as) au))))))))

@const-end

;; Nothing runs at power-up. Arm it from Ohmic, or type (wl-start) in the
;; LispBM console; (wl-off) disarms it.
