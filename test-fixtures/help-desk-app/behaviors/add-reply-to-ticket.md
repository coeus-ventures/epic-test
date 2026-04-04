# Add Reply to Ticket

Agents can respond to customer tickets with replies.

## Page Context

This behavior is part of the **Ticket Detail Page** at `/tickets/:id`.

Other behaviors on this page:
- Assign Ticket to Agent
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

### User adds a reply

#### Steps
* Act: Click the "New Ticket" button
* Act: Type "Feature request" into the subject input field
* Act: Type "Would like dark mode" into the description input field
* Act: Click the "Submit" button
* Act: Click on the ticket "Feature request"
* Act: Type "Thank you for your suggestion." into the reply input field
* Act: Click the "Send Reply" button
* Check: The text "Thank you for your suggestion." is visible on the page

