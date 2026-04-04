# Filter Tickets by Status

Users can filter the ticket list by status.

## Page Context

This behavior is part of the **Tickets Page** at `/tickets`.

Other behaviors on this page:
- Sign Out
- Create Ticket
- Filter Tickets by Priority
- Search Tickets

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-ticket**: User creates a ticket

Make sure your implementation integrates with these existing features.

## Examples

### User filters by status

#### Steps
* Act: Click the "New Ticket" button
* Act: Type "Open ticket" into the subject input field
* Act: Click the "Submit" button
* Act: Click the "New Ticket" button
* Act: Type "Another ticket" into the subject input field
* Act: Click the "Submit" button
* Act: Click on the ticket "Open ticket"
* Act: Select "Resolved" from the status dropdown
* Act: Click the "Save" button
* Act: Click the "Tickets" button in the navigation
* Act: Select "Open" from the status filter
* Check: The text "Another ticket" is visible on the page

