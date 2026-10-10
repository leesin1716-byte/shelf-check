// 데모 시나리오마다 Claude 에이전트를 한 번 실제로 돌려 data/agent-cache/ 에 저장한다(심사 기간 키 없이 재생)
// Usage: npm run precompute [-- maya jun]
// Needs ANTHROPIC_API_KEY, or ANTHROPIC_BASE_URL pointing at a compatible proxy.
import Anthropic from "@anthropic-ai/sdk";
import { personaInput, SCENARIO_IDS } from "../lib/agent/resolve";
import { runAgent } from "../lib/agent/run";
import { readCachedRun, writeCachedRun } from "../lib/agent/cache";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const ids = args.filter((a) => !a.startsWith("--"));
  const targets = ids.length ? ids : SCENARIO_IDS;
  for (const id of targets) {
    const input = personaInput(id);
    if (!force && readCachedRun(id, input)) {
      console.log(`${id}: cached run is current, skipping (use --force to redo)`);
      continue;
    }
    const client = new Anthropic({ defaultHeaders: { "x-ledger-note": id }, maxRetries: 1 });
    const started = Date.now();
    const run = await runAgent(input, {
      messages: client.messages,
      onStep: (s) => console.log(`  ${id} · ${s.tool}${s.isError ? " (rejected)" : ""}: ${s.result.split("\n")[0]}`),
    });
    const file = writeCachedRun(id, input, run);
    console.log(
      `${id}: accepted after ${run.turns} turns in ${((Date.now() - started) / 1000).toFixed(0)}s, ` +
        `${run.usage.input_tokens} in / ${run.usage.output_tokens} out -> ${file}`,
    );
    console.log(`  headline: ${run.plan.headline}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
