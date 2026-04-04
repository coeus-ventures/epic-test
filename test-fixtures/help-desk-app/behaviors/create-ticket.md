# Create Ticket

Users can create new support tickets with issue details.

## Page Context

This behavior is part of the **Tickets Page** at `/tickets`.

Other behaviors on this page:
- Sign Out
- Filter Tickets by Status
- Filter Tickets by Priority
- Search Tickets

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account

Make sure your implementation integrates with these existing features.

## Examples

### User creates a ticket

#### Steps
* Act: Click the "New Ticket" button
* Act: Type "Cannot login to my account" into the subject input field
* Act: Type "I keep getting an error message" into the description input field
* Act: Type "customer@example.com" into the customer email input field
* Act: Select "High" from the priority dropdown
* Act: Click the "Submit" button
* Check: The text "Cannot login to my account" is visible on the page

