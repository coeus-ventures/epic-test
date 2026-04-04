# Add Text Question

Users can add open-ended text questions to surveys.

## Page Context

This behavior is part of the **Survey Detail Page** at `/surveys/:id`.

Other behaviors on this page:
- Add NPS Question
- Add Multiple Choice Question
- Submit Survey Response

**Important**: Make sure this page includes UI elements (links, buttons, forms) for ALL behaviors listed above.

## Dependencies

This behavior requires the following to be implemented first:

1. **sign-up**: User creates a new account
2. **create-survey**: User creates a new survey

Make sure your implementation integrates with these existing features.

## Examples

### User adds a text question

#### Steps
* Act: Click the "Create Survey" button
* Act: Type "Feedback Survey" into the survey title input field
* Act: Click the "Save" button
* Act: Click on the survey "Feedback Survey"
* Act: Click the "Add Question" button
* Act: Select "Text" as the question type
* Act: Type "What could we do better?" into the question input field
* Act: Click the "Save" button
* Check: The text "What could we do better?" is visible on the page

