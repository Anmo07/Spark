"""Unit tests for the AgentDispatcher and reactive state transitions."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Dict

import pytest

from agents import AgentDispatcher, OllamaClient


class MockOllamaClient(OllamaClient):
    """Mock OllamaClient returning controlled schema-compliant responses."""

    def __init__(self, review_pass: bool = True) -> None:
        super().__init__()
        self.review_pass = review_pass
        self.call_history = []

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        timeout: float = 60.0,
    ) -> Dict[str, Any]:
        self.call_history.append({"system": system_prompt, "user": user_prompt})

        if "Lead Technical Supervisor" in system_prompt:
            return {
                "plan_overview": "Build a simple math module",
                "steps": [
                    {"step_number": 1, "assigned_role": "designer", "instructions": "Define interfaces"},
                    {"step_number": 2, "assigned_role": "coder", "instructions": "Write math functions"},
                ],
                "estimated_files": ["math_utils.py"],
            }
        elif "Systems Designer" in system_prompt:
            return {
                "architecture_overview": "Stateless utility module",
                "component_interfaces": {"add": "def add(a: int, b: int) -> int"},
                "file_structures": ["math_utils.py"],
            }
        elif "Senior Software Engineer" in system_prompt:
            return {
                "file_path": "math_utils.py",
                "code": "def add(a: int, b: int) -> int:\n    return a + b\n",
                "explanation": "Simple addition utility function",
            }
        elif "Lead Code Reviewer" in system_prompt:
            return {
                "passed": self.review_pass,
                "feedback": "Code is clean and correct" if self.review_pass else "Missing type hints",
                "suggested_fixes": [] if self.review_pass else ["Add type hints"],
            }

        return {}


@pytest.mark.asyncio
async def test_agent_dispatcher_full_lifecycle():
    """Verify the full chain: pending_supervisor -> pending_designer -> pending_coder -> pending_reviewer -> task_completed."""
    with tempfile.TemporaryDirectory() as temp_dir:
        workspace = Path(temp_dir)
        mock_llm = MockOllamaClient(review_pass=True)
        dispatcher = AgentDispatcher(llm_client=mock_llm, workspace_dir=workspace)

        # 1. Supervisor step
        evt_user = {
            "id": 1,
            "agent_role": "user",
            "status": "pending_supervisor",
            "data": {"prompt": "Create math utilities"},
        }
        res_sup = await dispatcher.process_event(evt_user)
        assert res_sup is not None
        assert res_sup["agent_role"] == "supervisor"
        assert res_sup["status"] == "pending_designer"
        assert "plan_overview" in res_sup["data"]

        # 2. Designer step
        evt_sup = {
            "id": 2,
            "agent_role": "supervisor",
            "status": "pending_designer",
            "data": res_sup["data"],
        }
        res_des = await dispatcher.process_event(evt_sup)
        assert res_des is not None
        assert res_des["agent_role"] == "designer"
        assert res_des["status"] == "pending_coder"
        assert "architecture_overview" in res_des["data"]

        # 3. Coder step
        evt_des = {
            "id": 3,
            "agent_role": "designer",
            "status": "pending_coder",
            "data": res_des["data"],
        }
        res_coder = await dispatcher.process_event(evt_des)
        assert res_coder is not None
        assert res_coder["agent_role"] == "coder"
        assert res_coder["status"] == "pending_reviewer"
        assert res_coder["data"]["file_path"] == "math_utils.py"

        # Check file was actually written to workspace
        saved_file = workspace / "math_utils.py"
        assert saved_file.exists()
        assert "def add" in saved_file.read_text()

        # 4. Reviewer step (Pass)
        evt_coder = {
            "id": 4,
            "agent_role": "coder",
            "status": "pending_reviewer",
            "data": res_coder["data"],
        }
        res_rev = await dispatcher.process_event(evt_coder)
        assert res_rev is not None
        assert res_rev["agent_role"] == "reviewer"
        assert res_rev["status"] == "task_completed"
        assert res_rev["data"]["passed"] is True


@pytest.mark.asyncio
async def test_circuit_breaker_on_repeated_rejection():
    """Verify that repeated reviewer rejections trigger the circuit breaker."""
    with tempfile.TemporaryDirectory() as temp_dir:
        workspace = Path(temp_dir)
        mock_llm = MockOllamaClient(review_pass=False)
        dispatcher = AgentDispatcher(llm_client=mock_llm, workspace_dir=workspace)
        dispatcher.circuit_breaker_limit = 2

        evt_coder = {
            "id": 100,
            "agent_role": "coder",
            "status": "pending_reviewer",
            "data": {"file_path": "bad.py", "code": "x = 1", "saved_file": "bad.py"},
        }

        # Attempt 1: Rejection -> loops back to pending_coder
        res1 = await dispatcher.process_event(evt_coder)
        assert res1["status"] == "pending_coder"
        assert res1["data"]["retry_count"] == 1

        # Attempt 2: Rejection -> loops back to pending_coder
        res2 = await dispatcher.process_event(evt_coder)
        assert res2["status"] == "pending_coder"
        assert res2["data"]["retry_count"] == 2

        # Attempt 3: Exceeds limit -> circuit breaker triggers task_completed
        res3 = await dispatcher.process_event(evt_coder)
        assert res3["status"] == "task_completed"
        assert "Circuit breaker" in res3["data"]["warning"]
