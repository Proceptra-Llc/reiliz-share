# Small-Business AI Automation Audit Method

This is the practical method used to identify where Claude Code, Claude agents, APIs, MCP connectors, and conventional automation can create useful business outcomes.

## 1. Establish business outcomes

Begin with measurable operational goals rather than a list of AI products. Examples include:

- Reduce response time
- Reduce repetitive staff work
- Improve follow-up consistency
- Improve training and knowledge access
- Reduce missed appointments or incomplete handoffs
- Improve management visibility

## 2. Map real workflows

For each workflow, capture:

- Trigger
- People and systems involved
- Inputs and outputs
- Decisions made
- Repetitive steps
- Exceptions and failure modes
- Required approvals
- Data sensitivity
- Current volume and effort

## 3. Classify the work

Determine whether the best fit is:

- Deterministic workflow automation
- Claude-assisted drafting or summarization
- Knowledge retrieval
- Tool-using agent
- Claude Code development automation
- API integration
- MCP connector
- Human-only process improvement

Not every workflow should become an agent.

## 4. Score opportunities

Use a simple 1–5 score for:

| Factor | Meaning |
|---|---|
| Business value | Revenue, service, quality, risk, or time benefit |
| Frequency | How often the workflow occurs |
| Repeatability | How consistently the workflow can be described |
| Data readiness | Whether required information is available and reliable |
| Integration readiness | Whether systems have suitable APIs or controlled interfaces |
| Risk | Privacy, regulatory, customer-impact, and error consequences |
| Maintainability | Ability of the internal team to understand and support it |

Prioritize high-value, repeatable, data-ready opportunities with manageable risk.

## 5. Select the proof of concept

The first proof of concept should be:

- Valuable enough to matter
- Narrow enough to complete and evaluate
- Safe enough to operate with human approval
- Connected to real systems where possible
- Measurable before and after implementation

For a healthcare or wellness business, a first engagement would usually avoid autonomous handling of sensitive clinical information. Lower-risk candidates may include internal knowledge retrieval, staff-training support, approved content drafting, or human-reviewed customer follow-up.

## 6. Define controls

Before implementation, define:

- Data allowed and prohibited
- Authentication and least-privilege requirements
- Human approval points
- Logging and audit needs
- Error and fallback behavior
- Ownership and maintenance procedures
- Success and rollback criteria

## 7. Build, test, and hand off

The proof of concept should include:

- Working implementation
- Test cases and known limitations
- Operating instructions
- Architecture and integration summary
- Credential and configuration ownership guidance without embedding secret values
- Recommended next steps based on measured results
