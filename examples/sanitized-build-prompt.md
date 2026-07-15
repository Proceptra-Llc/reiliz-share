# Representative Claude-to-Hercules Build Artifact

> **Sanitized example:** Names, paths, schemas, function signatures, tickets, and implementation details are representative and do not match the production Reiliz system.

## Mode

Scoped implementation with read-only pre-flight and explicit verification.

## Target area

Lead follow-up workspace: add an operator-reviewed draft suggestion to the communications panel.

## Objective

Help an operator prepare a context-aware follow-up message without allowing the AI to send a message autonomously.

## Pre-flight

Before changing any code:

1. Inspect the current communications-panel component and its child components.
2. Identify the existing query used to load the lead, recent communications, and assigned operator.
3. Identify the existing mutation used for operator-approved message sending.
4. Report any mismatch between the assumptions below and the live application.
5. Halt before implementation if the existing send path cannot preserve human approval.

## Functional scope

- Add a **Draft with AI** action beside the existing compose controls.
- Generate a draft using the selected lead's non-sensitive CRM context and recent operator-visible communications.
- Place generated text into the existing editable compose field.
- Require the operator to review and explicitly select the existing Send action.
- Show a clear error state if draft generation fails.
- Do not create a second message-send mutation or bypass the current communications workflow.

## Preservation requirements

- Preserve existing message history rendering.
- Preserve the existing send mutation and authorization checks.
- Preserve tenant scoping.
- Do not change external provider credentials or configuration.
- Do not automatically send, schedule, or queue a generated message.

## Out of scope

- Autonomous follow-up
- New campaign logic
- New provider integrations
- Bulk generation
- Changes to contact consent or messaging-compliance rules
- Production publishing

## Acceptance criteria

1. Operator can request a draft from the existing compose area.
2. Generated content appears only as editable draft text.
3. The existing Send action remains the only outbound-send path.
4. Failure produces a recoverable UI state and does not clear operator-entered text.
5. Tenant and authorization checks remain unchanged.
6. Type checking and existing relevant tests pass.
7. Close report names files changed, tests run, assumptions verified, and any remaining risks.

## Verification

Provide:

- Pre-flight findings
- Implementation summary
- Files changed
- Tests and checks executed
- Evidence for each acceptance criterion
- Known limitations
- Confirmation that no message was sent during testing
