# Delete Survey

Users can delete surveys from the system.

## Page Context

This behavior is part of the **Surveys Page** at `/surveys`.

Other behaviors on this page:
- Sign Out
- Create Survey
- Archive Survey

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-survey**: User creates a new survey

Make sure your implementation integrates with these existing features.

## Examples

### User deletes a survey

#### Steps
* Act: Click the "Create Survey" button
* Act: Type "Delete Test Survey" into the survey title input field
* Act: Click the "Save" button
* Check: The text "Delete Test Survey" is visible on the page
* Act: Click the delete button for "Delete Test Survey"
* Act: Click the "Confirm" button in the modal
* Check: The text "Delete Test Survey" is no longer visible on the page

