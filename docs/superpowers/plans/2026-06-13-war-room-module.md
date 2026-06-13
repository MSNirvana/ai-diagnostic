# War Room Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable "老板作战室" deliverable so diagnosis responses include a structured `war_room_plan` and the frontend presents it as the primary result page.

**Architecture:** Keep expert skills as raw diagnosis producers, add a backend `warroom` composer that converts `Questionnaire + ModuleResult[] + TriageSummary` into a stable `WarRoomPlan`, and render that plan through a new frontend `WarRoomPage`. The existing `Dashboard` remains available as the expert raw diagnosis view.

**Tech Stack:** FastAPI, Pydantic, pytest, React, TypeScript, Vitest, Testing Library.

---

### Task 1: Backend War Room Composer

**Files:**
- Create: `backend/app/models/warroom.py`
- Create: `backend/app/warroom/__init__.py`
- Create: `backend/app/warroom/composer.py`
- Test: `backend/tests/test_warroom_composer.py`

- [ ] Write failing composer tests for primary/secondary battlefield, department action generation, data gap dedupe, priority board, and checkpoints.
- [ ] Implement Pydantic models matching the UI spec.
- [ ] Implement rule-based composer using triage first and result signal fallback.
- [ ] Run `backend/.venv/bin/pytest backend/tests/test_warroom_composer.py -q` and confirm it passes.

### Task 2: Diagnose API Integration

**Files:**
- Modify: `backend/app/api/diagnose.py`
- Modify: `backend/tests/test_diagnose_api.py`

- [ ] Add failing API assertions that `/diagnose` includes `war_room_plan`.
- [ ] Compose `war_room_plan` after diagnosis history save so `record_id` can be included.
- [ ] Attach the same response field to `/diagnose/upload`.
- [ ] Run `backend/.venv/bin/pytest backend/tests/test_diagnose_api.py -q` and confirm it passes.

### Task 3: Frontend War Room Page

**Files:**
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/components/WarRoom/WarRoomPage.tsx`
- Create: `frontend/src/components/WarRoom/WarRoomPage.css`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/tests/war-room.test.tsx`

- [ ] Add failing frontend test for rendering summary, battlefields, decision items, battle chain, department actions, data gaps, and checkpoints.
- [ ] Add TypeScript types for `WarRoomPlan`.
- [ ] Implement consulting-style light tech War Room page.
- [ ] Make diagnosis completion prefer `WarRoomPage` when `diagnoseResult.war_room_plan` exists and keep expert raw view toggle.
- [ ] Run `cd frontend && npm test -- --run`.

### Task 4: Full Verification

**Files:**
- Verify only.

- [ ] Run `backend/.venv/bin/pytest backend/tests -q`.
- [ ] Run `cd frontend && npm test -- --run`.
- [ ] Run `cd frontend && npm run build`.
- [ ] Review `git diff --stat` and summarize touched files without reverting unrelated user changes.
