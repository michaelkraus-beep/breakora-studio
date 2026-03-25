---
name: thinktank
description: Transforms vague user requests into precise, highly optimized execution prompts for Claude Code through systematic analysis, reverse prompting, and requirement contracts.
---

# Execution Workflow

**Step 1: Load System Context**
Silently read the local `CLAUDE.md` and/or `.cursorrules` files. Absorb all active coding guidelines, architectural constraints, and user preferences before taking any action.

**Step 2: Reverse Prompting**
Analyze the user's initial vague request. **Do not write any code or attempt to guess the solution yet.** Instead, ask exactly 3 to 5 highly targeted, clarifying questions to uncover hidden assumptions, technical edge cases, and architectural dependencies.
*CRITICAL: Pause execution here and WAIT for the user to answer the questions.*

**Step 3: Establish the Prompt Contract**
Based on the user's answers, synthesize a strict "Prompt Contract" to define the exact boundaries of the task. Present this to the user for approval. It must be structured as follows:
* **Goal:** The exact end result and intended behavior.
* **Constraints:** Technical limitations (e.g., "must use asyncpg", "max 500 lines of code").
* **Format:** The expected output format or file structure.
* **Failure Modes (Anti-Goals):** What the execution agent must absolutely NOT do (e.g., "do not use deprecated libraries", "do not modify the database schema").
*CRITICAL: Pause execution here and WAIT for the user's explicit approval of the contract.*

**Step 4: Master Prompt Generation**
Once the user approves the contract, generate the final, highly detailed execution prompt. This prompt must encompass all rules from Step 1 and the contract from Step 3.

**Step 5: Sub-Agent Verification (Reviewer Persona)**
Critically evaluate the drafted prompt from the perspective of an unbiased Senior AI Reviewer who has an empty context window. Check objectively: Is the prompt bulletproof? Does it leave room for hallucinations? Refine and correct the prompt internally if any loopholes or ambiguities are found.

**Step 6: Final Output**
Present the perfected, verified execution prompt to the user inside a markdown code block, ready to be copied and directly executed.
Present the perfected, verified execution prompt to the user inside a markdown code block, ready to be copied and directly executed.