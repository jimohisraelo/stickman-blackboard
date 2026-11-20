# Stickman Teacher

A stickman standing in front of a blackboard. Pick a number, then press a button and he walks over and **points at it (with a teacher's pointer stick), circles it, underlines it, ticks it or crosses it out** in animated chalk.

Extras:
- **Sum**: pick two numbers one after the other. He points at both, writes the sum (e.g. `3 + 7 = 10`) on the board, and circles the answer.
- Count all the numbers, circle the largest, tick the even numbers, wave, erase the board, write new random numbers.
- **Stop** button and a queue counter: button presses queue up ("· 2 more queued"), and Stop clears them.

Live: https://stickman-blackboard-israel.netlify.app

Built with **plain HTML, CSS and the vanilla Canvas 2D API**. There are no libraries and no build step.

## Run it

Open `index.html` in a browser. Or serve the folder:

```bash
python -m http.server 5173
# then open http://localhost:5173
```

## Files

| File | What it does |
|---|---|
| `index.html` | Page layout: the canvas, the number chips and the action buttons |
| `style.css` | Styling for the page and buttons; the canvas scales to the screen width |
| `app.js` | All the drawing, animation and logic |

## How I built it (development process)

1. **Scene first.** I set up a fixed 1000×560 "world" on the canvas and scaled it for high-DPI screens. Then I drew the room (wall and floor), the blackboard (wood frame, green slate, chalk tray) and 10 numbers on a 5×2 grid.
2. **Stickman from joints.** The body is computed from a few joint positions: feet → hip → neck → shoulder → head, using fixed bone lengths. Everything is drawn with simple `lineTo` and `arc` calls, so moving one `x` value moves the whole man.
3. **The arm (inverse kinematics).** To point at or write on a number, I know the **shoulder** and the **target**, but not the elbow. A 2-bone IK function uses the **law of cosines** to get the elbow angle, so the arm bends naturally. If the target is out of reach, it clamps to full arm length.
4. **Game loop.** `requestAnimationFrame` calls `update(dt)` and then `draw()` every frame. Using `dt` (time since the last frame) keeps speeds the same on 60 Hz and 120 Hz screens. `dt` is capped so the animation doesn't jump after the tab was in the background.
5. **Actions as a queue of steps.** Each button doesn't animate directly. It builds a small script of steps: `walk → reach → trace → say → wait → rest`. The loop runs one step at a time. This made it easy to add new actions (e.g. "Count all" is just "point at each number" in a loop) and lets button presses queue up instead of fighting each other.
6. **Chalk marks.** Each mark (circle, underline, tick, cross) is a list of strokes made of points, with a little random jitter so it looks hand-drawn. While tracing, the hand follows the stroke and the line grows behind it (`drawn` length). The chalk look comes from two passes with different widths and opacity.
7. **Extending it.** The step queue paid off. **Sum** needed only one new step type, `write` (reveal text character by character while the hand follows and the stickman shuffles sideways). Everything else reuses existing steps: point, point, write, circle. **Stop** just clears the queue. A counter of queued actions shows in the status line.
8. **Polish.** I added walking (legs and the back arm swing with a sine wave), facing direction, a speech bubble, a glow on the selected number, clicking a number on the board to select it, and a status line.

## Possible next steps

- Sound effects for chalk.
- More operations (subtract, multiply) using the same `write` step.
- Keyboard shortcuts.
- Touch and drag to move the stickman.
