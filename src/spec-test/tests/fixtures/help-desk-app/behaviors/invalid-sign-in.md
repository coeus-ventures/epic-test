# Invalid Sign In

Users see an error when entering wrong credentials.

## Page Context

This behavior is part of the **Sign In Page** at `/sign-in`.

Other behaviors on this page:
- Sign In

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account

Make sure your implementation integrates with these existing features.

## Examples

### User enters wrong credentials

#### Steps
* Act: Navigate to http://localhost:3000/sign-in
* Act: Type "wrong@email.com" into the email input field
* Act: Type "wrongpassword" into the password input field
* Act: Click the "Sign In" button
* Check: An error message is displayed
* Check: The sign in form is still visible

