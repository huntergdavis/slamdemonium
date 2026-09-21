# FAQ

Short answers to the questions people arrive with. For the meaning of a specific term, see the [Glossary](GLOSSARY.md). When the car feels wrong and you want to fix it, see the [Tuning Playbook](TUNING_PLAYBOOK.md).

## What is this?

Slamdemonium Racing is a fast, loud, crash-happy arcade racer that runs in a browser tab. What you can play right now is its first milestone: a **driving-feel lab**. One car, one big paved circle, and a slider for every number that shapes how the car accelerates, brakes, grips and drifts. The goal of the lab is to find the driving feel that is fun before building a game around it.

## Why is the car a box?

Because the box is the honest version of the car. Everything you feel comes from forces the game adds to a plain rigid body: suspension, tires, engine, brakes and assists. A pretty car model would not change any of that, and it would hide whether the driving is good on its own. Models, liveries and crash damage come after the feel is right.

## Why is the track just a big circle?

Because a flat paved circle with a paved infield is the best place to judge feel. It has long corners for holding drifts, plenty of room to spin, and no bumps or elevation to confuse what a slider did. Real tracks, traffic and other cars arrive once the car on this circle feels fast and fun.

## What do I press?

Keyboard: **W** or **Up** to go, **S** or **Down** to brake and reverse, **A / D** or **Left / Right** to steer, **Space** for the handbrake, **Left Shift** to boost, **R** to respawn. **Escape** opens the pause menu, **O** opens the Options page directly. The full list is in the [README](../README.md#controls).

Controller: right trigger throttle, left trigger brake, left stick to steer, **A** handbrake, **X** boost, **Y** respawn, **Start** for the pause menu, where Options lives. Press a face button once to wake it up.

## How do I pause?

Two ways. **Escape** (or **Start** on a pad) opens the pause menu: Resume, Restart and Options, with the game frozen behind it. **P** just freezes the game where it is, with no menu, and a second **P** carries on; it is meant for stopping mid-corner to read the HUD. The menu works entirely from a controller: D-pad or left stick to move, **A** to select, **B** to back out, and left and right to adjust a slider or preset once you are in Options.

If you are in fullscreen, the first **Escape** leaves fullscreen, which is the browser's rule, not ours. Press it again for the menu.

## Does it need a controller?

No. Keyboard works and is designed to feel good: taps ramp up like a pedal instead of snapping to full, so digital keys behave more like analog ones. A controller is the better experience because its triggers are analog, so you can hold half throttle or ease onto the brake, which matters most for drifting. Both work at the same time; there is no mode to switch.

## I plugged in a controller and nothing happens

That is the browser, not the game. Browsers keep a controller invisible to a page until you press a button on it. Click the game once, then press any face button on the pad, and it wakes up. You only need to do this once per page load.

If it still does nothing after that, the pad is probably not reporting the standard layout the game expects. Most Xbox and PlayStation style pads do. Try a different USB port or cable, or a different pad. Bluetooth pads sometimes need to be reconnected after the browser opens.

If the pad works but the keyboard seems to override it, let go of every keyboard driving key. The keyboard takes priority only while one of those keys is actually held.

## Why does the car feel different when I change a slider?

Because the slider is the physics. There is no hidden "real" car underneath: each slider sets a number the car model reads at the start of the very next physics step. Drag `gripRear` down and the rear tires have less grip immediately. Nothing reloads, nothing resets. A few mass-related sliders rebuild the car's body, which takes a fraction of a second and still does not move it.

## What is a preset?

A named set of slider values applied over the defaults. Pick one from the dropdown at the top of the Options page and every slider jumps to it. **Save as...** stores your own under a name you choose, in your browser.

## Why does it say Grip, Drifty and Raw?

Those are the three presets that ship with the game, plus Default:

- **Default** is the starting guess.
- **Grip** is sticky, stable and forgiving. Slides are short and easy to recover.
- **Drifty** is tail-happy. Slides start easily and can be held for a long time.
- **Raw** turns every assist off so you feel the bare tire model, with no hidden helper left running. Twitchy, but honest. Try it first, then add assists back one at a time.

## How do I hold a drift, and how do I get out of one?

Get sliding first: flick the handbrake in a corner, or steer in hard on the throttle. Once the car is properly sideways, centering the stick holds the angle you have. Steer further into the slide for more angle. To exit, counter-steer fully or lift off the throttle, and the car straightens. If the tail swings past your maximum drift angle, a soft limiter nudges it back. All of this is the yaw assist; set it to zero and you are on your own.

You should be able to tell them apart within half a minute of driving. If you cannot, that is worth knowing.

## How do I share my settings?

Two ways, both in the Options page:

- **Share link** puts your changed values into the page URL. Copy it and send it. Anyone who opens the link gets your exact setup.
- **Export** downloads your full settings as a JSON file, including a log of every slider change you made. **Import** loads a file back in. This is the way to keep a setup you like or hand a complete tune to someone else.

Your current settings also save in your browser automatically, so closing the tab does not lose them. **Reset everything** clears them.

## How do I compare two setups?

Use the A/B slots. Copy A to B, change one thing in B, then press **Tab** while driving to swap between them instantly (or use the A and B buttons in the Options page). The HUD shows which slot is live. It is the fastest way to answer "was that better?"

## What is all the stuff on screen?

The HUD shows what the physics is doing: speed, slide angle, how much grip each wheel is using, pedal positions, the boost and drift meters, and a few scrolling graphs. Press **H** to cycle through full, minimal and off. Each element is explained in the [Glossary](GLOSSARY.md#the-hud).

## Why is there a slow-motion key?

Press **T** for quarter speed. It is the best way to watch what happens when a drift catches or a slide goes wrong. Slow motion runs the same physics with the same step size, so what you see is exactly what happens at full speed, only slower.

## What browsers work?

Current desktop Chrome, Firefox and Safari. The game is a static page with WebGL and WebAssembly and needs no plugins or accounts. It should reach a drivable state within a few seconds on a normal connection. Mobile is not a target for the lab.

## The car is stuck, flipped or gone. Now what?

Press **R**. It puts the car back on the track, pointing the right way, at a standstill. If the car ever falls off the world it comes back on its own.

## Something feels wrong. What do I turn?

Open the [Tuning Playbook](TUNING_PLAYBOOK.md). It lists symptoms (floaty, twitchy, will not drift, snaps into a spin) and the first sliders to try for each.
