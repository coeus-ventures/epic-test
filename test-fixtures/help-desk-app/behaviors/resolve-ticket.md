# Resolve Ticket

Agents can mark tickets as resolved.

## Page Context

This behavior is part of the **Ticket Detail Page** at `/tickets/:id`.

Other behaviors on this page:
- Assign Ticket to Agent
- Add Reply to Ticket
- Change Ticket Status
- Add Internal Note

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-ticket**: User creates a ticket

Make sure your implementation integrates with these existing features.

## Examples

### User resolves a ticket

#### Steps
* Act: Click the "New Ticket" button
* Act: Type "Password reset needed" into the subject input field
* Act: Click the "Submit" button
* Act: Click on the ticket "Password reset needed"
* Act: Type "Your password has been reset." into the reply input field
* Act: Click the "Send Reply" button
* Act: Click the "Resolve" button
* Check: The text "Resolved" is visible on the page

