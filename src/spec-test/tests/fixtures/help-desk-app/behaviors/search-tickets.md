# Search Tickets

Users can search for tickets by subject or content.

## Page Context

This behavior is part of the **Tickets Page** at `/tickets`.

Other behaviors on this page:
- Sign Out
- Create Ticket
- Filter Tickets by Status
- Filter Tickets by Priority

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-ticket**: User creates a ticket

Make sure your implementation integrates with these existing features.

## Examples

### User searches for a ticket

#### Steps
* Act: Click the "New Ticket" button
* Act: Type "Payment processing error" into the subject input field
* Act: Click the "Submit" button
* Act: Type "payment" into the search input field
* Check: The text "Payment processing error" is visible on the page

