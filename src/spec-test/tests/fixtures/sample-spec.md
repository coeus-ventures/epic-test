# Login

A user can log into the application with their email and password.

## Examples

### Login with valid credentials

#### Steps
* Act: User navigates to /login
* Act: User enters "user@example.com" in email field
* Act: User enters "password123" in password field
* Act: User clicks Login button
* Check: URL contains /dashboard
* Check: Welcome message is displayed
