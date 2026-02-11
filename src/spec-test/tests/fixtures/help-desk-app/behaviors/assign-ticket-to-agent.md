# Assign Ticket to Agent

Tickets can be assigned to specific support agents.

## Page Context

This behavior is part of the **Ticket Detail Page** at `/tickets/:id`.

Other behaviors on this page:
- Add Reply to Ticket
- Change Ticket Status
- Resolve Ticket
- Add Internal Note

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-ticket**: User creates a ticket

Make sure your implementation integrates with these existing features.

## Examples

### User assigns a ticket

#### Steps
* Act: Click the "New Ticket" button
* Act: Type "Billing inquiry" into the subject input field
* Act: Type "Need clarification on invoice" into the description input field
* Act: Click the "Submit" button
* Act: Click on the ticket "Billing inquiry"
* Act: Select "Agent Smith" from the assignee dropdown
* Act: Click the "Save" button
* Check: The text "Agent Smith" is visible on the page

