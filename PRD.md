# Product Requirements Document (PRD)

Multi-Agent Software Sandbox

1. Product Vision

To provide a highly scalable, entirely free local development sandbox where autonomous AI agents can collaboratively plan, write, and review software. The system must operate within the constraints of an Apple M-Series machine (16GB RAM/256GB SSD) by utilizing shared memory (prefix caching) and hyper-efficient model deployment.

2. Target Audience

⚬ Solo developers looking to automate boilerplate architecture and coding tasks.
⚬ Researchers and engineers studying autonomous multi-agent behavior and alignment via a local, private sandbox.

3. Core Features

⚬ Reactive Agent Workflows: Agents respond dynamically to environmental triggers (database states) rather than scripted linear paths.
⚬ Hardware-Optimized Parallelism: Ability to run 4 concurrent agent thoughts utilizing a single sub-3B model instance in memory.
⚬ Autonomous Tool Use: Agents can read/write local files and query the web (via DuckDuckGo) natively.
⚬ Search-Based Replay Engine: A timeline visualization allowing users to search specific terms (e.g., "memory leak fix") and instantly reconstruct the exact context and codebase state the agent saw at that millisecond.
⚬ Strict Type Alignment: System guarantees agents stay aligned by enforcing hard JSON schema validation between handoffs.

4. User Interface Requirements

⚬ Phase 1 (Current): A lightweight, single-page HTML interface served by FastAPI. Must include real-time WebSocket event streaming and a search bar for timeline querying.
⚬ Phase 2 (Future): A fully componentized React application.

5. Non-Functional Requirements

⚬ Memory Efficiency: Total RAM footprint of the AI server must not exceed 8GB (leaving 8GB for OS and orchestration).
⚬ Storage Limits: Core model weights must remain under 3GB.
⚬ Resilience: If an agent fails to output valid JSON or enters an infinite loop, the system must trigger a circuit breaker within 30 seconds, log the error, and attempt a speculative retry.
