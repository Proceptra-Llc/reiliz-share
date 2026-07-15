# Sanitized Architecture

## Objective

Create a governed development workflow in which Claude can understand current application state, produce implementation-ready instructions, dispatch work to the appropriate execution environment, and preserve a durable record of what was decided and built.

## Components

### GitHub documentation layer

Stores the durable artifacts needed to maintain continuity across AI and human sessions:

- Architecture decisions
- Product and UX specifications
- Scoped implementation artifacts
- Operating procedures
- Verification criteria
- Session handoffs and recovery guidance

GitHub is the system of record for **why** a change exists and **what** the implementation must achieve.

### Claude Code

Acts as the grounded authoring and orchestration layer. It can:

- Read the current documentation and implementation history through GitHub MCP
- Query live application state and implementation history through Hercules MCP
- Compare intended and actual state
- Produce tightly scoped implementation instructions
- Commit durable artifacts
- Dispatch approved work
- Review close reports and coordinate corrections

### Hercules

Holds and operates the live React and Convex application. It is responsible for implementation against the live application tree and returns implementation reports, diagnostic findings, and questions requiring decisions.

### Human decision owner

Retains control over:

- Net-new product scope
- Material architectural decisions
- Production publishing
- Changes affecting security, privacy, billing, customer data, or external communications

## Standard workflow

1. **Ground in durable context**
   - Read relevant specifications, decisions, and prior work.
2. **Inspect live state**
   - Review live application metadata, prior implementation threads, and read-only diagnostics.
3. **Identify variance**
   - Determine what is already present, stale, missing, or unsafe to change.
4. **Author an implementation contract**
   - Define scope, preservation rules, acceptance criteria, exclusions, and verification.
5. **Persist before execution**
   - Commit the artifact to GitHub.
6. **Dispatch through MCP**
   - Send the implementation request to the execution environment.
7. **Verify the report and behavior**
   - Review the close report and evidence against the acceptance criteria.
8. **Fix forward or document completion**
   - Iterate only where evidence shows a gap.

## Permission boundaries

| Action | Default posture |
|---|---|
| Read documentation and prior implementation history | Allowed |
| Run read-only diagnostics | Allowed |
| Draft specifications and implementation artifacts | Allowed |
| Commit sanitized or approved documentation | Allowed within repository policy |
| Modify live product behavior | Approval- or scope-gated |
| Publish production changes | Human controlled |
| Access or expose customer data or credentials | Prohibited unless explicitly authorized and properly controlled |

## Design principles

1. **Ground before acting.** Live state and durable documentation are checked before a change is specified.
2. **One actor per responsibility.** Strategy, detailed authoring, implementation, and approval have explicit owners.
3. **Durable artifacts before execution.** Important work does not exist only in chat history.
4. **Least privilege.** Read-only access is preferred for diagnostics; mutation rights are constrained.
5. **Evidence-based completion.** A completion report is checked against acceptance criteria rather than accepted at face value.
6. **No sensitive data in prompts or public artifacts.** Customer information, credentials, and production configuration remain outside the showcase and normal documentation flow.
