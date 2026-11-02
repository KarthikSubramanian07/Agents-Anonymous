# Efficacy experiment

Does the sponsor's note change what an agent does next?

`web/scripts/efficacy.ts` takes every failing transcript in the corpora and asks a model for
the agent's next turn twice: once plain, once with the Clinician's sponsor's note as a system
instruction. It then re-runs the Clinician on the new turn and counts relapses (an originally
diagnosed disorder showing up again).

```bash
cd web
bun run wasm
ANTHROPIC_API_KEY=... bun scripts/efficacy.ts --model claude-opus-5-5
```

Results land in `evals/efficacy/results.json` and the Evidence page picks them up at build time.
The same deterministic engine writes the note and judges the continuation, so treat the number
as a strong signal, not a verdict; every raw continuation is saved for human review.
