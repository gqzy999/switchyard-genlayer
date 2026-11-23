# Switchyard

A two-player rail dispatch game. Two players control trains entering a shared yard from opposite terminals. Each signs a three-tick dispatch. An Intelligent Contract records the instructions, uses independent validator interpretations, and fixes the outcome and replay on chain.

## Play

1. Open the [workbench](https://gqzy999.github.io/switchyard-genlayer/) and enter a deployed Stable Studionet contract address.
2. The West player connects an injected wallet or creates a temporary test wallet, then opens a match and assigns East to a distinct wallet. Save the match reference displayed after finalization.
3. Both players load the same reference and sign one explicit instruction each. For example, West can write “Tick 1: go to N. Tick 2: go to E. Tick 3: wait.” East can take S and then W to clear the yard, or take N on tick 1 to demonstrate a collision. Plans are visible after signing and cannot be edited. Temporary wallets disappear on page reload.
4. Either player resolves the match after both dispatches are signed. The board rereads the finalized outcome and shows the accepted positions or the first rejected move.

The track layout is a diamond. W and E each connect to N and S. W and E are opposite terminals. A train can hold or move to a connected station each tick. Occupying the same station or making a head-on swap blocks the run, as does an illegal move or expiry of the three-tick limit.

## Consensus and state

`open_match` creates a PLANNING match scoped to the West player's address. The second `dispatch` advances the match to READY. Each seat signs once, and only the assigned players may dispatch or resolve. During `resolve`, validators independently interpret the same signed text into two complete canonical command sequences. The equivalence check compares all six commands. Once agreed, deterministic replay sets CLEARED, BLOCKED, or UNCLEAR. Disagreement prevents the result from being written. Trains, rails and player-signed dispatches supply all the facts needed for adjudication.

## Develop and verify

```sh
npm ci
npm test
npm run build
genvm-lint check contracts/switchyard.py
STUDIO_SIGNERS=ephemeral npm run live
```

The SDK pin is declared in the contract header. The live script targets only chain 61999, checks the gas price, deploys the source, verifies on-chain source equality, and checks clear, collision, and duplicate dispatch flows against finalized state reads. The Python unit harness simulates callbacks to test behavior locally.

The current deployment attempt reverted before GenLayer consensus with `FeesDistributionMissing`. Its EVM receipt is in [deployment-attempt.json](evidence/deployment-attempt.json) and the lint output is in [genvm-lint.txt](evidence/genvm-lint.txt). The workbench has no default contract or public examples until live verification succeeds.
