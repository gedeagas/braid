---
sidebar_position: 4
title: Plan Mode
---

# Plan Mode

Sometimes you want Claude to think before it acts. Plan mode lets Claude propose an implementation strategy for you to review and approve before any code gets written. This is especially useful for large features, complex refactors, or situations where you want to align on the approach before committing to it.

## How plan mode works

When Claude enters plan mode, it shifts from execution to planning. Instead of immediately reading files, editing code, and running commands, Claude outlines what it intends to do — which files to change, what approach to take, what trade-offs exist, and what order to work in.

The plan appears **inline in the chat** as a structured message. You read it the same way you read any other Claude response, but the key difference is that Claude pauses and waits for your approval before proceeding.

:::note
Plan mode doesn't change what Claude can do. It changes when Claude does it. All the same tools are available — Claude just holds off on using them until you give the green light.
:::

## Review the plan

When Claude presents a plan, read through it carefully. A typical plan includes:

- **Goal summary** — What Claude understands you want to achieve.
- **Proposed approach** — The technical strategy Claude recommends.
- **Files to modify** — Which files Claude intends to touch and why.
- **Step-by-step breakdown** — The order of operations Claude plans to follow.
- **Potential concerns** — Edge cases, risks, or alternative approaches Claude considered.

Take your time reviewing. The whole point of plan mode is to catch misunderstandings or suboptimal approaches before any code changes happen.

## Approve the plan

When you're satisfied with Claude's proposal, click the **Approve** button on the `ExitPlanMode` prompt that appears inline in the chat. Claude immediately transitions back to execution mode and begins implementing the plan, using tools to read files, edit code, and run commands as needed.

:::tip
If the plan is mostly right but you want a small adjustment, you can approve it and then send a follow-up message with the specific tweak. Claude incorporates your feedback as it works through the implementation.
:::

## Reject with feedback

If the plan misses the mark, don't approve it. Instead, type your feedback into the response field on the `ExitPlanMode` prompt. Explain what you'd like changed — a different approach, different files, different priorities, or additional requirements Claude didn't account for.

Claude reads your feedback, revises its plan, and presents a new version for your review. This back-and-forth continues until you're happy with the direction. No code gets written until you explicitly approve.

### Common reasons to reject a plan

- **Wrong scope** — Claude is proposing to change more (or fewer) files than you intended.
- **Suboptimal approach** — You know a better pattern or library for the task.
- **Missing context** — Claude doesn't know about a constraint like backwards compatibility or a team convention.
- **Wrong priority** — Claude wants to start with the part you consider least important.

Provide specific, actionable feedback. Instead of "this isn't right," say "use the existing `AuthService` class instead of creating a new one" or "start with the database migration before touching the API layer."

## When to use plan mode

Plan mode shines in these situations:

### Large features

When you're building something that touches many files across multiple layers of the stack, a plan helps you verify Claude understands the full scope before it starts writing code everywhere.

### Unfamiliar codebases

If Claude hasn't seen much of the codebase yet, asking for a plan first lets you correct any wrong assumptions before they get baked into code.

### Risky refactors

When you're restructuring core abstractions or changing widely-used interfaces, reviewing the plan first prevents Claude from making sweeping changes that don't align with your architecture.

### Team alignment

If you need to share the approach with teammates before implementation, the plan gives you a concrete artifact to discuss. Once everyone agrees, approve it and let Claude execute.

:::tip
You can explicitly ask Claude to enter plan mode by saying something like "Plan how you'd implement this before writing any code" or by using the `/plan` command. Claude presents its strategy and waits for your approval.
:::

## Plan mode and message queueing

You can queue a message while Claude is generating a plan. If you realize you forgot to mention a requirement, type it out and it will be sent to Claude as soon as the current plan is presented. This saves you from having to reject and restate — your additional context arrives alongside your approval decision.

## Iterating on plans

There's no limit to how many times you can reject and request revisions. Each round of feedback narrows the gap between what you want and what Claude proposes. In practice, most plans converge within one or two rounds of feedback, especially when you provide clear, specific direction.

Once approved, Claude references the plan throughout implementation. If it encounters something unexpected — a file that's structured differently than anticipated, or a test that reveals a flaw in the approach — it may ask you a clarifying question rather than silently deviating from the agreed-upon plan.
