## 1: live run

**rUn Fusion batch - 20**

```bash
cd demo
npx tsx live-run/01-run-fusion-batch.ts
```

TIMESTAMP LOG 2026-05-25T15:25:00.000Z

**run gpt-4o alone - 20**

```bash
npx tsx live-run/02-run-gpt4o-alone.ts
```

** run compare fude vs gpt-4o pairwise**
npx tsx live-run/03-compare-fused-vs-gpt4o.ts --since "TIMESTAMP"

\*\* report winrate
npx tsx live-run/04-generate-live-report.ts --since "TIMESTAMP"

## Reports từ dâtbase

npx tsx from-database/01-axis-a-report.ts

npx tsx from-database/02-axis-b-rubric.ts

npx tsx from-database/03-axis-b-fused-vs-best.ts

npx tsx from-database/04-axis-b-fused-vs-each.ts

npx tsx from-database/05-axis-b-fused-vs-gpt4o.ts

npx tsx from-database/06-axis-b-factuality.ts

npx tsx from-database/07-axis-c-human-eval.ts

npx tsx from-database/08-full-unified-report.ts
