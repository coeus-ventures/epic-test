# Change Ticket Status

Agents can update ticket status as they work on issues.

## Page Context

This behavior is part of the **Ticket Detail Page** at `/tickets/:id`.

Other behaviors on this page:
- Assign Ticket to Agent
- Add Reply to Ticket
- Resolve Ticket
- Add Internal Note

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-ticket**: User creates a ticket

Make sure your implementation integrates with these existing features.

## Examples

### User changes ticket status

#### Steps
* Act: Click the "New Ticket" button
* Act: Type "Status test ticket" into the subject input field
* Act: Click the "Submit" button
* Act: Click on the ticket "Status test ticket"
* Act: Select "In Progress" from the status dropdown
* Act: Click the "Save" button
* Check: The text "In Progress" is visible on the page

