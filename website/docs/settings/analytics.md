---
sidebar_position: 11
title: Analytics
---

# Analytics

The Analytics page is a local dashboard that shows usage statistics aggregated from your session history. All data is computed on your machine from the sessions stored in `~/Braid/sessions/` - nothing is sent externally.

## Open the analytics dashboard

Go to **Settings > Analytics**.

## Time range

Use the range selector at the top to filter by **Today**, **Week**, **Month**, or **All Time**. All stats below update to reflect the selected period.

## Overview stats

The overview section shows key metrics at a glance:

- **Sessions** - Total number of sessions created.
- **Messages** - Total user messages sent.
- **Total tokens** - Combined input and output tokens consumed.
- **Time with Claude** - Total run duration across all sessions.
- **Lines written** - Lines of code added by Claude (from tool call diff stats).
- **Days active** - Number of days since your first session.

## Activity chart

The activity chart shows your usage pattern as a bar graph. Switch between **Today**, **Yesterday**, and **Week** views:

- **Today / Yesterday** - Hourly buckets (24 bars) showing messages sent per hour.
- **Week** - Daily buckets (7 bars) showing messages sent per day.

## Model usage

A breakdown of which Claude models you use most, showing the percentage of sessions using each model (Sonnet, Opus, Haiku).

## Top tools

A ranked bar chart of Claude's most-used tools (Bash, Edit, Read, Write, etc.) with invocation counts and average execution time.

## Feature usage

Shows how often you use extended thinking and plan mode across your sessions.
