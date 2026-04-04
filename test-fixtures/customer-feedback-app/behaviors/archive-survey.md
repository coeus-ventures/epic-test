# Archive Survey

Users can archive surveys to keep them but hide from active list.

## Page Context

This behavior is part of the **Surveys Page** at `/surveys`.

Other behaviors on this page:
- Sign Out
- Create Survey
- Delete Survey

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-survey**: User creates a new survey

Make sure your implementation integrates with these existing features.

## Examples

### User archives a survey

#### Steps
* Act: Click the "Create Survey" button
* Act: Type "Archive Test Survey" into the survey title input field
* Act: Click the "Save" button
* Act: Click the archive button for "Archive Test Survey"
* Check: The text "Archived" is visible on the page

