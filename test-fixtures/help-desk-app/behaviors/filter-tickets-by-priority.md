# Filter Tickets by Priority

Users can filter tickets by priority level.

## Page Context

This behavior is part of the **Tickets Page** at `/tickets`.

Other behaviors on this page:
- Sign Out
- Create Ticket
- Filter Tickets by Status
- Search Tickets

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-ticket**: User creates a ticket

Make sure your implementation integrates with these existing features.

## Examples

### User filters by priority

#### Steps
* Act: Click the "New Ticket" button
* Act: Type "Urgent issue" into the subject input field
* Act: Select "High" from the priority dropdown
* Act: Click the "Submit" button
* Act: Click the "New Ticket" button
* Act: Type "Minor question" into the subject input field
* Act: Select "Low" from the priority dropdown
* Act: Click the "Submit" button
* Act: Select "High" from the priority filter
* Check: The text "Urgent issue" is visible on the page

