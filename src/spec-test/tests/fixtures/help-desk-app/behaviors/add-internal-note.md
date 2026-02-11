# Add Internal Note

Agents can add internal notes visible only to the support team.

## Page Context

This behavior is part of the **Ticket Detail Page** at `/tickets/:id`.

Other behaviors on this page:
- Assign Ticket to Agent
- Add Reply to Ticket
- Change Ticket Status
- Resolve Ticket

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-ticket**: User creates a ticket

Make sure your implementation integrates with these existing features.

## Examples

### User adds an internal note

#### Steps
* Act: Click the "New Ticket" button
* Act: Type "Complex issue" into the subject input field
* Act: Click the "Submit" button
* Act: Click on the ticket "Complex issue"
* Act: Click the "Add Internal Note" button
* Act: Type "Escalating to engineering team" into the note input field
* Act: Click the "Save" button
* Check: The text "Escalating to engineering team" is visible on the page

