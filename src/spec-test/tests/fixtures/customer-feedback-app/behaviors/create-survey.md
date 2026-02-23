# Create Survey

Users can create new feedback surveys.

## Page Context

This behavior is part of the **Surveys Page** at `/surveys`.

Other behaviors on this page:
- Sign Out
- Delete Survey
- Archive Survey

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account

Make sure your implementation integrates with these existing features.

## Examples

### User creates a new survey

#### Steps
* Act: Click the "Create Survey" button
* Act: Type "Customer Satisfaction Q1 2024" into the survey title input field
* Act: Type "Help us improve our service" into the description input field
* Act: Click the "Save" button
* Check: The text "Customer Satisfaction Q1 2024" is visible on the page

