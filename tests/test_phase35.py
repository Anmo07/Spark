"""Unit tests for Phase 3.5: Advanced Workspace CRUD, HITL Roadmap, and Live Tracking."""

import asyncio
import os
import shutil
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

ROOT_DIR = Path(__file__).parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import database
from database import init_db
from main import app, event_bus, manager, WORKSPACE_DIR
import main
from schemas import MasterRouterResponse, SupervisorResponse, SupervisorPlanStep


@pytest.fixture(autouse=True)
def setup_teardown():
    """Setup clean workspace and DB for each test."""
    test_workspace = ROOT_DIR / "sandbox_workspace"
    test_workspace.mkdir(parents=True, exist_ok=True)
    main.active_roadmap = None
    main.session_modified_files.clear()
    while not event_bus.empty():
        try:
            event_bus.get_nowait()
            event_bus.task_done()
        except Exception:
            break
    yield
    main.active_roadmap = None
    main.session_modified_files.clear()


@pytest.mark.asyncio
async def test_workspace_file_nested_creation_and_delete():
    """Verify POST /workspace/file automatically creates parent dirs and DELETE /workspace/file deletes it."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Write file in deeply nested directory
        nested_path = "sub1/sub2/sub3/test_code.py"
        res = await client.post(
            "/workspace/file",
            json={"path": nested_path, "content": "print('hello from nested')"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "written"
        assert (WORKSPACE_DIR / nested_path).exists()
        assert (WORKSPACE_DIR / nested_path).read_text() == "print('hello from nested')"

        # 2. Rename file
        renamed_path = "sub1/sub2/sub3/renamed_code.py"
        res = await client.put(
            "/workspace/rename",
            json={"old_path": nested_path, "new_path": renamed_path},
        )
        assert res.status_code == 200
        assert not (WORKSPACE_DIR / nested_path).exists()
        assert (WORKSPACE_DIR / renamed_path).exists()

        # 3. Delete file via query parameter
        res = await client.delete(f"/workspace/file?path={renamed_path}")
        assert res.status_code == 200
        assert not (WORKSPACE_DIR / renamed_path).exists()

        # Clean up directory
        shutil.rmtree(WORKSPACE_DIR / "sub1", ignore_errors=True)


@pytest.mark.asyncio
async def test_hitl_roadmap_workflow():
    """Verify Master Agent generates roadmap, pauses, updates on feedback, and resumes on Proceed."""
    transport = ASGITransport(app=app)
    mock_plan = SupervisorResponse(
        plan_overview="Build a modern counter widget",
        steps=[
            SupervisorPlanStep(step_number=1, assigned_role="designer", instructions="Design UI"),
            SupervisorPlanStep(step_number=2, assigned_role="coder", instructions="Code Counter.jsx"),
        ],
        estimated_files=["Counter.jsx"],
    )

    mock_revised_plan = SupervisorResponse(
        plan_overview="Build a modern counter widget with TypeScript",
        steps=[
            SupervisorPlanStep(step_number=1, assigned_role="designer", instructions="Design UI types"),
            SupervisorPlanStep(step_number=2, assigned_role="coder", instructions="Code Counter.tsx"),
        ],
        estimated_files=["Counter.tsx"],
    )

    with patch.object(
        main.master_agent,
        "route",
        new=AsyncMock(return_value=MasterRouterResponse(intent="project_execution")),
    ), patch.object(
        main.dispatcher,
        "generate_roadmap",
        new=AsyncMock(return_value=mock_plan),
    ), patch.object(
        main.dispatcher,
        "revise_roadmap",
        new=AsyncMock(return_value=mock_revised_plan),
    ):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. User requests a project task
            res = await client.post("/chat", json={"prompt": "Build a counter widget"})
            assert res.status_code == 200
            data = res.json()
            assert data["type"] == "roadmap"
            assert data["status"] == "awaiting_approval"
            assert data["roadmap"]["plan_overview"] == "Build a modern counter widget"
            # Pipeline MUST be paused: no events placed on event_bus!
            assert event_bus.qsize() == 0

            # 2. User provides custom instructions to revise the roadmap
            res = await client.post("/chat", json={"prompt": "Use TypeScript please"})
            assert res.status_code == 200
            data = res.json()
            assert data["type"] == "roadmap"
            assert data["status"] == "awaiting_approval"
            assert data["roadmap"]["plan_overview"] == "Build a modern counter widget with TypeScript"
            assert event_bus.qsize() == 0

            # 3. User approves by replying "Proceed"
            res = await client.post("/chat", json={"prompt": "Proceed"})
            assert res.status_code == 200
            data = res.json()
            assert data["type"] == "system_event"
            assert "Roadmap approved" in data["content"]
            # Execution pipeline has now resumed: event was pushed to event_bus!
            assert event_bus.qsize() == 1


@pytest.mark.asyncio
async def test_roadmap_dedicated_endpoints():
    """Verify /roadmap/approve and /roadmap/feedback endpoints."""
    transport = ASGITransport(app=app)
    mock_plan = SupervisorResponse(
        plan_overview="Initial Plan",
        steps=[SupervisorPlanStep(step_number=1, assigned_role="coder", instructions="Do X")],
        estimated_files=["x.py"],
    )
    mock_revised = SupervisorResponse(
        plan_overview="Revised via API",
        steps=[SupervisorPlanStep(step_number=1, assigned_role="coder", instructions="Do Y")],
        estimated_files=["y.py"],
    )

    with patch.object(
        main.dispatcher, "generate_roadmap", new=AsyncMock(return_value=mock_plan)
    ), patch.object(
        main.dispatcher, "revise_roadmap", new=AsyncMock(return_value=mock_revised)
    ), patch.object(
        main.master_agent, "route", new=AsyncMock(return_value=MasterRouterResponse(intent="project_execution"))
    ):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Trigger roadmap
            await client.post("/chat", json={"prompt": "Build app"})
            assert main.active_roadmap is not None
            assert main.active_roadmap["status"] == "awaiting_approval"

            # 2. Feedback via endpoint
            res = await client.post("/roadmap/feedback", json={"feedback": "Change to Y"})
            assert res.status_code == 200
            data = res.json()
            assert data["roadmap"]["plan_overview"] == "Revised via API"

            # 3. Approve via endpoint
            res = await client.post("/roadmap/approve")
            assert res.status_code == 200
            assert res.json()["status"] == "approved"
            assert main.active_roadmap["status"] == "approved"
            assert event_bus.qsize() == 1


@pytest.mark.asyncio
async def test_master_agent_final_summary():
    """Verify MasterAgent generates a final summary with modified files."""
    completion_data = {
        "summary": "Calculator component built and reviewed",
        "file_path": "Calculator.jsx",
    }
    with patch.object(
        main.master_agent.llm,
        "generate_text",
        new=AsyncMock(return_value="🎉 **Task Complete!** Built Calculator.jsx successfully!"),
    ):
        summary = await main.master_agent.generate_final_summary(
            completion_data=completion_data,
            modified_files=["Calculator.jsx", "Calculator.css"],
        )
        assert "Calculator.jsx" in summary


def test_websocket_fs_update_and_file_crud():
    """Verify WebSocket broadcasts fs_update when files are created, renamed, or deleted."""
    from starlette.testclient import TestClient
    client = TestClient(app)
    with client.websocket_connect("/ws/events") as websocket:
        # 1. Create file -> fs_update
        res = client.post("/workspace/file", json={"path": "test_ws_file.txt", "content": "content"})
        assert res.status_code == 200
        event = websocket.receive_json()
        assert event["type"] == "fs_update"
        assert event["path"] == "test_ws_file.txt"

        # 2. Rename file -> fs_update
        res = client.put("/workspace/rename", json={"old_path": "test_ws_file.txt", "new_path": "test_ws_file_renamed.txt"})
        assert res.status_code == 200
        event = websocket.receive_json()
        assert event["type"] == "fs_update"
        assert event["action"] == "rename"

        # 3. Delete file -> fs_update
        res = client.delete("/workspace/file?path=test_ws_file_renamed.txt")
        assert res.status_code == 200
        event = websocket.receive_json()
        assert event["type"] == "fs_update"
        assert event["action"] == "delete"

