## Health
Areas `workouts`, `sleep`, `nutrition` (parent `health`); a vault may have its own workout areas (`running`), each drawn
with ```` ```block-workouts ```` and `area:`. A workout log has `kind` (Strength, Run, Climb...), optional `place`, and
`exercises` (sets) or `climbs` (`[{grade, note}]`, or just `top_grade`). A meal is one nutrition log: `meal: Lunch`,
`kcal`, `protein`, `carbs`, `fat` (estimates from a photo are fine). A workout log's area draws ```` ```block-workout ````
under its fields.

No files of its own: it draws the workout, sleep and nutrition logs (the Health page).
