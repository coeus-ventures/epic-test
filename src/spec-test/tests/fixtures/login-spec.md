# Login

Test the login behavior with valid credentials.

Directory: `app/(app)/auth/behaviors/login/`

## Examples

### Login with valid credentials

#### Steps
* Act: User enters "user@example.com" in email field
* Act: User enters "password123" in password field
* Act: User clicks Login button
* Check: URL contains /dashboard
* Check: Page title contains Dashboard
