# Sign In

Support agents can sign in to access the help desk.

## Page Context

This behavior is part of the **Sign In Page** at `/sign-in`.

Other behaviors on this page:
- Invalid Sign In

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account

Make sure your implementation integrates with these existing features.

## Examples

### User signs in successfully

#### Steps
* Act: Navigate to http://localhost:3000/sign-in
* Act: Type "agent@company.com" into the email input field
* Act: Type "demo123" into the password input field
* Act: Click the "Sign In" button
* Check: The page displays a button to create a ticket or navigate the application

