# AttendWise: Student Attendance Portal

Smart Attendance. Better Planning.

AttendWise is a static, browser-based attendance calculator and planner. It calculates your current attendance, predicts future attendance under attend or miss scenarios, plans how many lectures you need to reach a target, and keeps a local calculation history. There is no backend, no account, and no paid API.

## Formula

    effectiveAbsent      = combinedAbsentOAA - oaaAttendance
    attendancePercentage = 100 - ((effectiveAbsent / totalLectures) * 100)

Values stay unrounded internally and are rounded to 2 decimals for display only.

## Project layout

    attendwise/
      index.html          page shell, header, nav, five views
      css/styles.css      purple and lavender theme, responsive layout, mobile menu
      js/engine.js        pure calculation engine (no DOM, no storage)
      js/storage.js       localStorage wrapper with in-memory fallback
      js/app.js           UI controller (reads inputs, calls engine, renders)
      tests/run-tests.js  Node test suite for the engine and storage

The engine never touches the DOM or storage. The UI never does calculation itself.

## Run locally

Option 1: open index.html directly in a browser. Everything runs from files, so no server is needed.

Option 2: serve the folder with any static server, for example:

    cd attendwise
    python3 -m http.server 8080

then open http://localhost:8080

Requirements for tests only: Node.js 14 or newer.

## Run the tests

    cd attendwise
    node tests/run-tests.js

The script exits with code 1 if any check fails.

## Deploy to GitHub Pages

1. Create a new GitHub repository, for example attendwise.
2. Put the contents of the attendwise folder at the repository root (index.html must sit at the top level, not inside a subfolder).
3. Commit and push to the main branch:

       git init
       git add .
       git commit -m "AttendWise initial release"
       git branch -M main
       git remote add origin https://github.com/<your-username>/attendwise.git
       git push -u origin main

4. On GitHub, open Settings, then Pages. Under "Build and deployment", set Source to "Deploy from a branch", choose branch main and folder / (root), then save.
5. After a minute or two the site is live at https://<your-username>.github.io/attendwise/

All asset paths are relative, so the site works from a project subpath.

## Offline use

Once the page has loaded, the app runs without a network connection because all code and styles are local files.

## Test results

Test suite: tests/run-tests.js, run with node. Last run: 34 passed, 0 failed.

Checks that passed:
- Formula fixtures: (9,8,576) gives 99.83%, (10,5,100) gives 95.00%, (20,10,100) gives 90.00%, (0,0,100) gives 100.00%, (10,10,100) gives 100.00%.
- Breakdown text: "Effective Absent = 9 - 8 = 1" and "Attendance = 100 - ((1/576)*100) = 99.83%".
- Validation: empty input, negative numbers, decimals, zero total lectures, OAA above combined absent, combined absent above total lectures.
- Future predictor for T=100, A=10, lpd=8: attend 5 days gives 92.86%, miss 1 day gives 83.33%.
- Target planner for T=100, A=10, target 95%: required lectures 100, projected total 200, projected 95.00%, college days 13.
- Attendance impact: attend and miss arithmetic, and rejection of negative counts.
- Storage: settings save and reload, invalid settings rejected rather than clamped, reset to defaults, memory fallback when localStorage fails, history capped at 50 entries, history clear.

Known differences from the spec (the formula was kept as written):
- Attend 10 days: the formula gives 94.44%, while the spec fixture says 95.00%.
- Miss 2 days: the formula gives 77.59%, while the spec fixture says 77.78%.
The tests assert the formula's actual output for these two cases and are labelled as such.

Not verified: browser rendering and the responsive layout at 320px were not checked in a headless browser in this build. The CSS and JavaScript were written to the spec but have not been visually confirmed.

## Notes

- Settings and history live in localStorage under the keys attendwise.settings.v1 and attendwise.history.v1. If localStorage is unavailable, the app falls back to memory for the session and shows a message.
- Clearing browser data removes saved settings and history.
